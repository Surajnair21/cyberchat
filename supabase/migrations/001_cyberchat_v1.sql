create extension if not exists pgcrypto;

create table if not exists public.app_settings (
  key text primary key,
  value text not null
);

insert into public.app_settings (key, value)
values ('initial_admin_username', 'admin')
on conflict (key) do nothing;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-zA-Z0-9_]{3,24}$'),
  display_name text not null,
  avatar_color text not null default '#22d3ee',
  role text not null default 'member' check (role in ('admin', 'member')),
  public_key_jwk jsonb,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 48),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,64}$'),
  description text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  active boolean not null default true,
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (room_id, user_id)
);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  username text not null check (username ~ '^[a-zA-Z0-9_]{3,24}$'),
  code_hash text not null unique,
  created_by uuid not null references public.profiles(id) on delete cascade,
  claimed_by uuid references public.profiles(id) on delete set null,
  claimed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.invite_rooms (
  invite_id uuid not null references public.invites(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  primary key (invite_id, room_id)
);

create table if not exists public.user_key_vaults (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  salt text not null,
  iv text not null,
  wrapped_private_key text not null,
  public_key_jwk jsonb not null,
  kdf text not null default 'PBKDF2-SHA-256',
  iterations integer not null default 250000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.room_key_shares (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  key_version integer not null,
  wrapped_room_key text not null,
  iv text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (room_id, user_id, key_version)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  key_version integer not null,
  created_at timestamptz not null default now()
);

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null check (char_length(reaction) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, reaction)
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

create trigger user_key_vaults_touch_updated_at
before update on public.user_key_vaults
for each row execute function public.touch_updated_at();

create or replace function public.is_admin(check_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = check_user and role = 'admin' and disabled_at is null
  );
$$;

create or replace function public.is_active_room_member(check_room uuid, check_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.room_members rm
    join public.profiles p on p.id = rm.user_id
    where rm.room_id = check_room
      and rm.user_id = check_user
      and rm.active = true
      and p.disabled_at is null
  );
$$;

create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role is distinct from new.role and not public.is_admin(auth.uid()) then
    raise exception 'Only admins can change roles';
  end if;

  return new;
end;
$$;

create trigger profiles_prevent_role_escalation
before update on public.profiles
for each row execute function public.prevent_role_escalation();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_username text;
  requested_display text;
  initial_admin text;
  new_role text := 'member';
begin
  requested_username := coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1));
  requested_display := coalesce(new.raw_user_meta_data->>'display_name', requested_username);
  select value into initial_admin from public.app_settings where key = 'initial_admin_username';

  if lower(requested_username) = lower(initial_admin)
     and not exists (select 1 from public.profiles where role = 'admin') then
    new_role := 'admin';
  end if;

  insert into public.profiles (id, username, display_name, role)
  values (new.id, requested_username, requested_display, new_role);

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.claim_invite(p_code_hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_row public.invites%rowtype;
  profile_row public.profiles%rowtype;
begin
  select * into profile_row from public.profiles where id = auth.uid();
  if profile_row.id is null then
    raise exception 'Profile is required';
  end if;

  select * into invite_row
  from public.invites
  where code_hash = p_code_hash
    and claimed_by is null
    and lower(username) = lower(profile_row.username)
    and (expires_at is null or expires_at > now())
  limit 1;

  if invite_row.id is null then
    raise exception 'Invite is invalid or expired';
  end if;

  update public.invites
  set claimed_by = profile_row.id, claimed_at = now()
  where id = invite_row.id;

  insert into public.room_members (room_id, user_id)
  select room_id, profile_row.id from public.invite_rooms
  where invite_id = invite_row.id
  on conflict (room_id, user_id) do update
    set active = true, removed_at = null;
end;
$$;

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.invites enable row level security;
alter table public.invite_rooms enable row level security;
alter table public.user_key_vaults enable row level security;
alter table public.room_key_shares enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;

create policy "Profiles are visible to active members and admins"
on public.profiles for select
using (
  id = auth.uid()
  or public.is_admin()
  or exists (
    select 1 from public.room_members mine
    join public.room_members theirs on theirs.room_id = mine.room_id
    where mine.user_id = auth.uid()
      and mine.active = true
      and theirs.user_id = profiles.id
      and theirs.active = true
  )
);

create policy "Users can update their profile"
on public.profiles for update
using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());

create policy "Rooms are visible to members"
on public.rooms for select
using (public.is_admin() or public.is_active_room_member(id));

create policy "Admins create rooms"
on public.rooms for insert
with check (public.is_admin());

create policy "Admins update rooms"
on public.rooms for update
using (public.is_admin())
with check (public.is_admin());

create policy "Room members visible inside room"
on public.room_members for select
using (public.is_admin() or public.is_active_room_member(room_id));

create policy "Admins manage room members"
on public.room_members for all
using (public.is_admin())
with check (public.is_admin());

create policy "Admins manage invites"
on public.invites for all
using (public.is_admin())
with check (public.is_admin());

create policy "Admins manage invite rooms"
on public.invite_rooms for all
using (public.is_admin())
with check (public.is_admin());

create policy "Users manage their own key vault"
on public.user_key_vaults for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "Room key shares visible to owner"
on public.room_key_shares for select
using (user_id = auth.uid() or public.is_admin());

create policy "Members create room key shares"
on public.room_key_shares for insert
with check (
  created_by = auth.uid()
  and public.is_active_room_member(room_id)
  and exists (
    select 1 from public.room_members
    where room_id = room_key_shares.room_id
      and user_id = room_key_shares.user_id
      and active = true
  )
);

create policy "Messages visible to room members"
on public.messages for select
using (public.is_active_room_member(room_id));

create policy "Members send encrypted messages"
on public.messages for insert
with check (sender_id = auth.uid() and public.is_active_room_member(room_id));

create policy "Reactions visible to room members"
on public.message_reactions for select
using (
  exists (
    select 1 from public.messages
    where messages.id = message_reactions.message_id
      and public.is_active_room_member(messages.room_id)
  )
);

create policy "Members react once per message"
on public.message_reactions for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.messages
    where messages.id = message_reactions.message_id
      and public.is_active_room_member(messages.room_id)
  )
);

create policy "Users remove their reactions"
on public.message_reactions for delete
using (user_id = auth.uid());

-- Enable Realtime replication for dynamic updates
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.message_reactions;
alter publication supabase_realtime add table public.room_key_shares;

