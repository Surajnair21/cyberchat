import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel, Session } from '@supabase/supabase-js';
import {
  Activity,
  ArrowRight,
  Copy,
  KeyRound,
  LogOut,
  MessageSquare,
  Plus,
  Radio,
  RefreshCw,
  Send,
  Shield,
  Sparkles,
  Terminal,
  UserPlus,
  Users,
} from 'lucide-react';
import { supabase, hasSupabaseConfig, initialAdminUsername, usernameToEmail } from './lib/supabase';
import {
  createUserVault,
  decryptText,
  encryptText,
  generateRoomKey,
  hashInviteCode,
  makeInviteCode,
  slugify,
  unlockUserVault,
  unwrapRoomKey,
  wrapRoomKey,
} from './lib/crypto';
import type {
  CryptoIdentity,
  DecryptedMessage,
  Invite,
  MessageReaction,
  MessageRow,
  Profile,
  Room,
  RoomKeyCache,
  RoomKeyShare,
  RoomMember,
  UserKeyVault,
} from './lib/types';

type Status = { tone: 'ok' | 'error' | 'info'; text: string } | null;
type PresenceState = Record<string, { username: string; typing: boolean }[]>;

const avatarColors = ['#22d3ee', '#34d399', '#f472b6', '#a78bfa', '#facc15', '#fb7185'];
const reactions = ['+1', '<3', '!!', '??'];

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="grid gap-2 text-xs uppercase tracking-[0.22em] text-cyan-200/70">
      {props.label}
      <input
        className="h-11 rounded border border-cyan-400/20 bg-slate-950/80 px-3 font-mono text-sm text-cyan-50 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20"
        type={props.type || 'text'}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        required={props.required}
      />
    </label>
  );
}

function Button(props: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type={props.type || 'button'}
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      className={cx(
        'inline-flex h-10 items-center justify-center gap-2 rounded border px-4 font-mono text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40',
        props.variant === 'ghost' &&
          'border-cyan-400/20 bg-slate-950/40 text-cyan-100 hover:border-cyan-300/60 hover:bg-cyan-300/10',
        props.variant === 'danger' &&
          'border-rose-400/40 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20',
        (!props.variant || props.variant === 'primary') &&
          'border-cyan-300/70 bg-cyan-300 text-slate-950 hover:bg-cyan-200',
      )}
    >
      {props.children}
    </button>
  );
}

function Panel(props: { children: React.ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-lg border border-cyan-400/15 bg-slate-950/70 shadow-terminal', props.className)}>
      {props.children}
    </section>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <div
      className={cx(
        'rounded border px-3 py-2 font-mono text-sm',
        status.tone === 'error' && 'border-rose-400/30 bg-rose-500/10 text-rose-100',
        status.tone === 'ok' && 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100',
        status.tone === 'info' && 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100',
      )}
    >
      {status.text}
    </div>
  );
}

function SetupNotice() {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-950 p-6 text-cyan-50">
      <Panel className="max-w-2xl p-6">
        <div className="mb-4 flex items-center gap-3">
          <Terminal className="text-cyan-300" />
          <h1 className="font-mono text-2xl font-bold">CyberChat setup required</h1>
        </div>
        <p className="text-slate-300">
          Add your Supabase values to <span className="font-mono text-cyan-200">.env</span>, run the SQL migration in
          Supabase, then restart the dev server.
        </p>
        <pre className="mt-4 overflow-auto rounded border border-cyan-400/15 bg-black/50 p-4 text-sm text-cyan-200">
          VITE_SUPABASE_URL=https://your-project.supabase.co{'\n'}
          VITE_SUPABASE_ANON_KEY=your-anon-key{'\n'}
          VITE_INITIAL_ADMIN_USERNAME=admin
        </pre>
      </Panel>
    </div>
  );
}

function AuthScreen({
  onStatus,
}: {
  onStatus: (status: Status) => void;
}) {
  const [mode, setMode] = useState<'login' | 'claim' | 'admin'>('login');
  const [username, setUsername] = useState(initialAdminUsername);
  const [displayName, setDisplayName] = useState('Cyber Admin');
  const [password, setPassword] = useState('');
  const [vaultPassphrase, setVaultPassphrase] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function saveNewVault(userId: string) {
    const { vault } = await createUserVault(vaultPassphrase, userId);
    const { error: vaultError } = await supabase.from('user_key_vaults').upsert(vault);
    if (vaultError) throw vaultError;

    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        public_key_jwk: vault.public_key_jwk,
        avatar_color: avatarColors[Math.floor(Math.random() * avatarColors.length)],
      })
      .eq('id', userId);
    if (profileError) throw profileError;
  }

  async function handleAuth(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    onStatus(null);

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({
          email: usernameToEmail(username),
          password,
        });
        if (error) throw error;
        onStatus({ tone: 'ok', text: 'Session opened. Unlock your local key vault.' });
        return;
      }

      if (!vaultPassphrase || vaultPassphrase.length < 10) {
        throw new Error('Vault passphrase must be at least 10 characters.');
      }

      const { data, error } = await supabase.auth.signUp({
        email: usernameToEmail(username),
        password,
        options: {
          data: {
            username: username.trim(),
            display_name: displayName.trim() || username.trim(),
          },
        },
      });
      if (error) throw error;
      if (!data.user) throw new Error('Signup did not return a user.');

      await saveNewVault(data.user.id);

      if (mode === 'claim') {
        const codeHash = await hashInviteCode(inviteCode);
        const { error: claimError } = await supabase.rpc('claim_invite', { p_code_hash: codeHash });
        if (claimError) throw claimError;
      }

      onStatus({
        tone: 'ok',
        text:
          data.session === null
            ? 'Account created. If email confirmation is enabled, confirm before logging in.'
            : 'Account created and vault sealed.',
      });
    } catch (error) {
      onStatus({ tone: 'error', text: error instanceof Error ? error.message : 'Auth failed.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-grid p-4 text-cyan-50">
      <Panel className="w-full max-w-lg p-5">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 font-mono text-sm uppercase tracking-[0.25em] text-cyan-300">
              <Shield size={18} /> CyberChat
            </div>
            <h1 className="font-mono text-3xl font-bold text-white">secure channel</h1>
          </div>
          <div className="rounded border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 font-mono text-xs text-emerald-200">
            E2EE ON
          </div>
        </div>

        <div className="mb-5 grid grid-cols-3 gap-2 rounded border border-cyan-400/15 bg-slate-950 p-1">
          {[
            ['login', 'Login'],
            ['claim', 'Claim Invite'],
            ['admin', 'First Admin'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key as 'login' | 'claim' | 'admin')}
              className={cx(
                'h-9 rounded font-mono text-xs font-semibold uppercase tracking-wider transition',
                mode === key ? 'bg-cyan-300 text-slate-950' : 'text-cyan-200 hover:bg-cyan-300/10',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <form className="grid gap-4" onSubmit={handleAuth}>
          <Field label="Username" value={username} onChange={setUsername} required />
          {mode !== 'login' && <Field label="Display name" value={displayName} onChange={setDisplayName} required />}
          {mode === 'claim' && <Field label="Invite code" value={inviteCode} onChange={setInviteCode} required />}
          <Field label="Password" type="password" value={password} onChange={setPassword} required />
          {mode !== 'login' && (
            <Field
              label="Vault passphrase"
              type="password"
              value={vaultPassphrase}
              onChange={setVaultPassphrase}
              placeholder="Used to recover your encryption key"
              required
            />
          )}
          <Button type="submit" disabled={busy}>
            <ArrowRight size={16} />
            {busy ? 'Working...' : mode === 'login' ? 'Enter' : 'Create secure identity'}
          </Button>
        </form>
      </Panel>
    </div>
  );
}

function VaultUnlock({
  onUnlock,
  onStatus,
}: {
  onUnlock: (identity: CryptoIdentity) => void;
  onStatus: (status: Status) => void;
}) {
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    onStatus(null);

    try {
      const { data, error } = await supabase.from('user_key_vaults').select('*').single<UserKeyVault>();
      if (error) throw error;
      const identity = await unlockUserVault(data, passphrase);
      onUnlock(identity);
      onStatus({ tone: 'ok', text: 'Vault unlocked. Local decryptor online.' });
    } catch (error) {
      onStatus({ tone: 'error', text: error instanceof Error ? error.message : 'Could not unlock vault.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-grid p-4 text-cyan-50">
      <Panel className="w-full max-w-md p-5">
        <div className="mb-6 flex items-center gap-3">
          <KeyRound className="text-cyan-300" />
          <div>
            <h1 className="font-mono text-2xl font-bold">unlock vault</h1>
            <p className="text-sm text-slate-400">Your private key decrypts only in this browser.</p>
          </div>
        </div>
        <form className="grid gap-4" onSubmit={unlock}>
          <Field label="Vault passphrase" type="password" value={passphrase} onChange={setPassphrase} required />
          <Button type="submit" disabled={busy}>
            <Shield size={16} />
            {busy ? 'Decrypting...' : 'Unlock'}
          </Button>
        </form>
      </Panel>
    </div>
  );
}

function AppShell({
  session,
  profile,
  identity,
  onSignOut,
  onStatus,
}: {
  session: Session;
  profile: Profile;
  identity: CryptoIdentity;
  onSignOut: () => void;
  onStatus: (status: Status) => void;
}) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [roomKeys, setRoomKeys] = useState<RoomKeyCache>({});
  const [reactionsByMessage, setReactionsByMessage] = useState<Record<string, MessageReaction[]>>({});
  const [presence, setPresence] = useState<PresenceState>({});
  const [draft, setDraft] = useState('');
  const [adminRefresh, setAdminRefresh] = useState(0);
  const typingTimer = useRef<number | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const activeRoom = useMemo(
    () => rooms.find((room) => room.id === activeRoomId) || rooms[0] || null,
    [activeRoomId, rooms],
  );

  const latestKey = activeRoom ? latestRoomKey(roomKeys[activeRoom.id]) : null;

  const loadRooms = useCallback(async () => {
    const { data, error } = await supabase.from('rooms').select('*').order('created_at', { ascending: true });
    if (error) throw error;
    const nextRooms = (data || []) as Room[];
    setRooms(nextRooms);
    setActiveRoomId((current) => current || nextRooms[0]?.id || null);
  }, []);

  const loadProfiles = useCallback(async () => {
    const { data, error } = await supabase.from('profiles').select('*');
    if (error) throw error;
    setProfiles(Object.fromEntries(((data || []) as Profile[]).map((item) => [item.id, item])));
  }, []);

  const loadRoomKeys = useCallback(async () => {
    const { data, error } = await supabase.from('room_key_shares').select('*').order('key_version', { ascending: true });
    if (error) throw error;

    const next: RoomKeyCache = {};
    for (const share of (data || []) as RoomKeyShare[]) {
      try {
        const roomKey = await unwrapRoomKey(identity, share.wrapped_room_key, share.iv);
        next[share.room_id] = {
          ...(next[share.room_id] || {}),
          [share.key_version]: roomKey,
        };
      } catch {
        onStatus({ tone: 'error', text: 'A room key share could not be decrypted.' });
      }
    }
    setRoomKeys(next);
  }, [identity, onStatus]);

  const decryptRows = useCallback(
    async (rows: MessageRow[]) => {
      const decrypted = await Promise.all(
        rows.map(async (row) => {
          const key = roomKeys[row.room_id]?.[row.key_version];
          if (!key) return { ...row, plaintext: '[locked: missing room key]', failed: true };
          try {
            return { ...row, plaintext: await decryptText(key, row.ciphertext, row.iv) };
          } catch {
            return { ...row, plaintext: '[decrypt failed]', failed: true };
          }
        }),
      );
      return decrypted;
    },
    [roomKeys],
  );

  const loadMessages = useCallback(async () => {
    if (!activeRoom) return;
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('room_id', activeRoom.id)
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) throw error;
    const decrypted = await decryptRows((data || []) as MessageRow[]);
    setMessages(decrypted);

    if (decrypted.length > 0) {
      const { data: reactionRows } = await supabase
        .from('message_reactions')
        .select('*')
        .in(
          'message_id',
          decrypted.map((message) => message.id),
        );
      const grouped: Record<string, MessageReaction[]> = {};
      ((reactionRows || []) as MessageReaction[]).forEach((reaction) => {
        grouped[reaction.message_id] = [...(grouped[reaction.message_id] || []), reaction];
      });
      setReactionsByMessage(grouped);
    } else {
      setReactionsByMessage({});
    }
  }, [activeRoom, decryptRows]);

  const loadMembers = useCallback(async () => {
    if (!activeRoom) return;
    const { data, error } = await supabase.from('room_members').select('*').eq('room_id', activeRoom.id);
    if (error) throw error;
    setMembers((data || []) as RoomMember[]);
  }, [activeRoom]);

  useEffect(() => {
    void Promise.all([loadRooms(), loadProfiles(), loadRoomKeys()]).catch((error: unknown) => {
      onStatus({ tone: 'error', text: error instanceof Error ? error.message : 'Initial load failed.' });
    });
  }, [loadProfiles, loadRoomKeys, loadRooms, onStatus, adminRefresh]);

  useEffect(() => {
    void Promise.all([loadMessages(), loadMembers()]).catch((error: unknown) => {
      onStatus({ tone: 'error', text: error instanceof Error ? error.message : 'Room load failed.' });
    });
  }, [loadMembers, loadMessages, onStatus]);

  useEffect(() => {
    if (!activeRoom) return;
    if (channelRef.current) supabase.removeChannel(channelRef.current);

    const channel = supabase.channel(`room:${activeRoom.id}`, {
      config: { presence: { key: session.user.id } },
    });

    channel
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${activeRoom.id}` }, async (payload) => {
        const [message] = await decryptRows([payload.new as MessageRow]);
        setMessages((current) => {
          if (current.some((item) => item.id === message.id)) return current;
          return [...current, message];
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, () => {
        void loadMessages();
      })
      .on('presence', { event: 'sync' }, () => {
        setPresence(channel.presenceState() as PresenceState);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ username: profile.username, typing: false });
        }
      });

    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeRoom, decryptRows, loadMessages, profile.username, session.user.id]);

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!activeRoom || !latestKey || !draft.trim()) return;

    try {
      const encrypted = await encryptText(latestKey.key, draft.trim());
      const { error } = await supabase.from('messages').insert({
        room_id: activeRoom.id,
        sender_id: session.user.id,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        key_version: latestKey.version,
      });
      if (error) throw error;
      setDraft('');
      await channelRef.current?.track({ username: profile.username, typing: false });
    } catch (error) {
      onStatus({ tone: 'error', text: error instanceof Error ? error.message : 'Message failed.' });
    }
  }

  async function reactToMessage(messageId: string, reaction: string) {
    const existing = reactionsByMessage[messageId]?.some(
      (item) => item.user_id === session.user.id && item.reaction === reaction,
    );
    const request = existing
      ? supabase
          .from('message_reactions')
          .delete()
          .eq('message_id', messageId)
          .eq('user_id', session.user.id)
          .eq('reaction', reaction)
      : supabase.from('message_reactions').insert({ message_id: messageId, user_id: session.user.id, reaction });
    const { error } = await request;
    if (error) onStatus({ tone: 'error', text: error.message });
    await loadMessages();
  }

  async function handleTyping(value: string) {
    setDraft(value);
    await channelRef.current?.track({ username: profile.username, typing: value.length > 0 });
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      void channelRef.current?.track({ username: profile.username, typing: false });
    }, 1200);
  }

  const presenceList = Object.entries(presence)
    .filter(([key]) => key !== session.user.id)
    .flatMap(([, values]) => values)
    .filter(Boolean);
  const typingList = presenceList.filter((item) => item.typing).map((item) => item.username);

  return (
    <div className="min-h-screen bg-grid text-cyan-50">
      <header className="border-b border-cyan-400/15 bg-slate-950/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded border border-cyan-300/40 bg-cyan-300/10">
              <Terminal className="text-cyan-300" size={22} />
            </div>
            <div>
              <div className="font-mono text-lg font-bold text-white">CyberChat</div>
              <div className="font-mono text-xs uppercase tracking-[0.2em] text-emerald-300">encrypted mesh online</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="font-mono text-sm text-cyan-100">{profile.display_name}</div>
              <div className="text-xs text-slate-400">@{profile.username} / {profile.role}</div>
            </div>
            <Button variant="ghost" onClick={onSignOut} title="Sign out">
              <LogOut size={16} />
              <span className="hidden sm:inline">Exit</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-[260px_minmax(0,1fr)_340px]">
        <Panel className="overflow-hidden">
          <div className="border-b border-cyan-400/15 p-4">
            <div className="flex items-center gap-2 font-mono text-sm uppercase tracking-[0.2em] text-cyan-300">
              <Radio size={16} /> Rooms
            </div>
          </div>
          <div className="grid gap-1 p-2">
            {rooms.map((room) => (
              <button
                key={room.id}
                onClick={() => setActiveRoomId(room.id)}
                className={cx(
                  'rounded px-3 py-3 text-left transition',
                  activeRoom?.id === room.id ? 'bg-cyan-300 text-slate-950' : 'text-cyan-100 hover:bg-cyan-300/10',
                )}
              >
                <div className="font-mono text-sm font-bold"># {room.name}</div>
                <div className="truncate text-xs opacity-70">{room.description || 'secure room'}</div>
              </button>
            ))}
            {rooms.length === 0 && <div className="p-3 text-sm text-slate-400">No rooms yet. Create one as admin.</div>}
          </div>
        </Panel>

        <Panel className="flex min-h-[72vh] flex-col overflow-hidden">
          <div className="border-b border-cyan-400/15 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-mono text-xl font-bold text-white"># {activeRoom?.name || 'no-room'}</h2>
                <p className="text-sm text-slate-400">
                  {latestKey ? `key v${latestKey.version} loaded` : 'waiting for a room key share'}
                </p>
              </div>
              <div className="flex items-center gap-2 rounded border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 font-mono text-xs text-emerald-200">
                <Activity size={14} />
                {presenceList.length + 1} online
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((message) => {
              const sender = profiles[message.sender_id];
              const mine = message.sender_id === session.user.id;
              return (
                <article
                  key={message.id}
                  className={cx(
                    'rounded border p-3',
                    mine ? 'border-cyan-400/30 bg-cyan-400/10' : 'border-slate-700 bg-slate-950/60',
                  )}
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="size-3 rounded-full"
                        style={{ backgroundColor: sender?.avatar_color || '#22d3ee' }}
                      />
                      <span className="font-mono text-sm text-cyan-100">@{sender?.username || 'unknown'}</span>
                    </div>
                    <time className="font-mono text-xs text-slate-500">
                      {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </time>
                  </div>
                  <p className={cx('whitespace-pre-wrap break-words text-sm leading-6', message.failed && 'text-rose-200')}>
                    {message.plaintext}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {reactions.map((reaction) => {
                      const count = reactionsByMessage[message.id]?.filter((item) => item.reaction === reaction).length || 0;
                      return (
                        <button
                          key={reaction}
                          onClick={() => void reactToMessage(message.id, reaction)}
                          className="rounded border border-cyan-400/15 bg-slate-950 px-2 py-1 font-mono text-xs text-cyan-100 hover:bg-cyan-300/10"
                        >
                          {reaction} {count > 0 ? count : ''}
                        </button>
                      );
                    })}
                  </div>
                </article>
              );
            })}
            {messages.length === 0 && (
              <div className="grid h-full place-items-center text-center text-slate-400">
                <div>
                  <MessageSquare className="mx-auto mb-3 text-cyan-300" />
                  <p className="font-mono">No decrypted traffic yet.</p>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-cyan-400/15 p-4">
            <div className="mb-2 h-5 text-xs text-slate-400">
              {typingList.length > 0 ? `${typingList.join(', ')} typing...` : ' '}
            </div>
            <form className="flex gap-2" onSubmit={sendMessage}>
              <input
                className="min-w-0 flex-1 rounded border border-cyan-400/20 bg-slate-950 px-3 font-mono text-sm text-cyan-50 outline-none focus:border-cyan-300"
                value={draft}
                onChange={(event) => void handleTyping(event.target.value)}
                placeholder={latestKey ? 'Encrypt and transmit...' : 'Room key required'}
                disabled={!latestKey}
              />
              <Button type="submit" disabled={!latestKey || !draft.trim()}>
                <Send size={16} />
              </Button>
            </form>
          </div>
        </Panel>

        <aside className="grid gap-4 content-start">
          <Panel className="p-4">
            <div className="mb-3 flex items-center gap-2 font-mono text-sm uppercase tracking-[0.2em] text-cyan-300">
              <Users size={16} /> Members
            </div>
            <div className="grid gap-2">
              {members.map((member) => (
                <div key={member.user_id} className="flex items-center justify-between rounded border border-cyan-400/10 bg-slate-950/60 px-3 py-2">
                  <div>
                    <div className="font-mono text-sm text-cyan-100">@{profiles[member.user_id]?.username || 'loading'}</div>
                    <div className="text-xs text-slate-500">{member.active ? 'active' : 'removed'}</div>
                  </div>
                  {member.active && profile.role === 'admin' && member.user_id !== session.user.id && (
                    <button
                      className="font-mono text-xs text-rose-200 hover:text-rose-100"
                      onClick={() => void removeMember(member)}
                    >
                      remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          </Panel>

          {profile.role === 'admin' && (
            <AdminPanel
              profile={profile}
              session={session}
              rooms={rooms}
              roomKeys={roomKeys}
              onRefresh={() => setAdminRefresh((value) => value + 1)}
              onStatus={onStatus}
            />
          )}
        </aside>
      </main>
    </div>
  );

  async function removeMember(member: RoomMember) {
    if (!activeRoom || !latestKey) return;
    try {
      const { error: memberError } = await supabase
        .from('room_members')
        .update({ active: false, removed_at: new Date().toISOString() })
        .eq('room_id', activeRoom.id)
        .eq('user_id', member.user_id);
      if (memberError) throw memberError;

      const nextKey = await generateRoomKey();
      const nextVersion = latestKey.version + 1;
      const activeMembers = members.filter((item) => item.active && item.user_id !== member.user_id);
      for (const activeMember of activeMembers) {
        const recipient = profiles[activeMember.user_id];
        if (!recipient?.public_key_jwk) continue;
        const wrapped = await wrapRoomKey(nextKey, recipient.public_key_jwk);
        const { error: shareError } = await supabase.from('room_key_shares').insert({
          room_id: activeRoom.id,
          user_id: activeMember.user_id,
          key_version: nextVersion,
          wrapped_room_key: wrapped.wrapped_room_key,
          iv: wrapped.iv,
          created_by: session.user.id,
        });
        if (shareError) throw shareError;
      }

      onStatus({ tone: 'ok', text: 'Member removed and room key rotated.' });
      await Promise.all([loadMembers(), loadRoomKeys()]);
    } catch (error) {
      onStatus({ tone: 'error', text: error instanceof Error ? error.message : 'Member removal failed.' });
    }
  }
}

function latestRoomKey(keys?: Record<number, CryptoKey>) {
  const versions = Object.keys(keys || {}).map(Number).sort((a, b) => b - a);
  const version = versions[0];
  if (!version || !keys) return null;
  return { version, key: keys[version] };
}

function AdminPanel({
  profile,
  session,
  rooms,
  roomKeys,
  onRefresh,
  onStatus,
}: {
  profile: Profile;
  session: Session;
  rooms: Room[];
  roomKeys: RoomKeyCache;
  onRefresh: () => void;
  onStatus: (status: Status) => void;
}) {
  const [roomName, setRoomName] = useState('general');
  const [roomDescription, setRoomDescription] = useState('main secure channel');
  const [inviteUsername, setInviteUsername] = useState('');
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
  const [lastInvite, setLastInvite] = useState<{ username: string; code: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (selectedRooms.length === 0 && rooms[0]) setSelectedRooms([rooms[0].id]);
  }, [rooms, selectedRooms.length]);

  async function createRoom(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const { data: room, error: roomError } = await supabase
        .from('rooms')
        .insert({
          name: roomName.trim(),
          slug: `${slugify(roomName)}-${Date.now().toString(36)}`,
          description: roomDescription.trim(),
          created_by: session.user.id,
        })
        .select('*')
        .single<Room>();
      if (roomError) throw roomError;

      const { error: memberError } = await supabase.from('room_members').insert({
        room_id: room.id,
        user_id: session.user.id,
        role: 'owner',
      });
      if (memberError) throw memberError;

      if (!profile.public_key_jwk) throw new Error('Your profile is missing a public key.');
      const roomKey = await generateRoomKey();
      const wrapped = await wrapRoomKey(roomKey, profile.public_key_jwk);
      const { error: shareError } = await supabase.from('room_key_shares').insert({
        room_id: room.id,
        user_id: session.user.id,
        key_version: 1,
        wrapped_room_key: wrapped.wrapped_room_key,
        iv: wrapped.iv,
        created_by: session.user.id,
      });
      if (shareError) throw shareError;

      setRoomName('');
      setRoomDescription('');
      onStatus({ tone: 'ok', text: 'Room created with encrypted key share.' });
      onRefresh();
    } catch (error) {
      onStatus({ tone: 'error', text: error instanceof Error ? error.message : 'Room creation failed.' });
    } finally {
      setBusy(false);
    }
  }

  async function createInvite(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const code = makeInviteCode();
      const codeHash = await hashInviteCode(code);
      const { data: invite, error: inviteError } = await supabase
        .from('invites')
        .insert({
          username: inviteUsername.trim(),
          code_hash: codeHash,
          created_by: session.user.id,
        })
        .select('*')
        .single<Invite>();
      if (inviteError) throw inviteError;

      if (selectedRooms.length > 0) {
        const { error: roomsError } = await supabase.from('invite_rooms').insert(
          selectedRooms.map((roomId) => ({
            invite_id: invite.id,
            room_id: roomId,
          })),
        );
        if (roomsError) throw roomsError;
      }

      setLastInvite({ username: inviteUsername.trim(), code });
      setInviteUsername('');
      onStatus({ tone: 'ok', text: 'Invite generated. Share the code privately.' });
    } catch (error) {
      onStatus({ tone: 'error', text: error instanceof Error ? error.message : 'Invite failed.' });
    } finally {
      setBusy(false);
    }
  }

  async function syncRoomKeys() {
    setBusy(true);
    try {
      const { data: memberRows, error: membersError } = await supabase.from('room_members').select('*').eq('active', true);
      if (membersError) throw membersError;
      const { data: profileRows, error: profilesError } = await supabase.from('profiles').select('*');
      if (profilesError) throw profilesError;
      const { data: shareRows, error: sharesError } = await supabase.from('room_key_shares').select('*');
      if (sharesError) throw sharesError;

      const profileMap = Object.fromEntries(((profileRows || []) as Profile[]).map((item) => [item.id, item]));
      const shareSet = new Set(
        ((shareRows || []) as RoomKeyShare[]).map((share) => `${share.room_id}:${share.user_id}:${share.key_version}`),
      );

      let created = 0;
      for (const room of rooms) {
        const latest = latestRoomKey(roomKeys[room.id]);
        if (!latest) continue;

        const roomMembers = ((memberRows || []) as RoomMember[]).filter((member) => member.room_id === room.id);
        for (const member of roomMembers) {
          const shareKey = `${room.id}:${member.user_id}:${latest.version}`;
          const recipient = profileMap[member.user_id];
          if (shareSet.has(shareKey) || !recipient?.public_key_jwk) continue;

          const wrapped = await wrapRoomKey(latest.key, recipient.public_key_jwk);
          const { error: insertError } = await supabase.from('room_key_shares').insert({
            room_id: room.id,
            user_id: member.user_id,
            key_version: latest.version,
            wrapped_room_key: wrapped.wrapped_room_key,
            iv: wrapped.iv,
            created_by: session.user.id,
          });
          if (insertError) throw insertError;
          created += 1;
        }
      }

      onStatus({ tone: 'ok', text: `Key sync complete. Created ${created} missing shares.` });
      onRefresh();
    } catch (error) {
      onStatus({ tone: 'error', text: error instanceof Error ? error.message : 'Key sync failed.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="p-4">
      <div className="mb-4 flex items-center gap-2 font-mono text-sm uppercase tracking-[0.2em] text-cyan-300">
        <Sparkles size={16} /> Admin
      </div>

      <form className="mb-5 grid gap-3" onSubmit={createRoom}>
        <Field label="Room name" value={roomName} onChange={setRoomName} required />
        <Field label="Description" value={roomDescription} onChange={setRoomDescription} />
        <Button type="submit" disabled={busy || !roomName.trim()}>
          <Plus size={16} /> Create room
        </Button>
      </form>

      <form className="mb-5 grid gap-3 border-t border-cyan-400/15 pt-5" onSubmit={createInvite}>
        <Field label="Invite username" value={inviteUsername} onChange={setInviteUsername} required />
        <div className="grid gap-2">
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-cyan-200/70">Default rooms</div>
          <div className="grid gap-2">
            {rooms.map((room) => (
              <label key={room.id} className="flex items-center gap-2 text-sm text-cyan-100">
                <input
                  type="checkbox"
                  checked={selectedRooms.includes(room.id)}
                  onChange={(event) => {
                    setSelectedRooms((current) =>
                      event.target.checked ? [...current, room.id] : current.filter((id) => id !== room.id),
                    );
                  }}
                />
                # {room.name}
              </label>
            ))}
          </div>
        </div>
        <Button type="submit" disabled={busy || !inviteUsername.trim()}>
          <UserPlus size={16} /> Generate invite
        </Button>
      </form>

      {lastInvite && (
        <div className="mb-5 rounded border border-emerald-400/30 bg-emerald-500/10 p-3">
          <div className="mb-1 font-mono text-xs uppercase tracking-[0.2em] text-emerald-200">
            Invite for @{lastInvite.username}
          </div>
          <div className="flex items-center justify-between gap-2 rounded bg-black/40 px-3 py-2 font-mono text-sm text-emerald-100">
            <span>{lastInvite.code}</span>
            <button onClick={() => void navigator.clipboard.writeText(lastInvite.code)} title="Copy invite code">
              <Copy size={16} />
            </button>
          </div>
        </div>
      )}

      <Button variant="ghost" onClick={syncRoomKeys} disabled={busy}>
        <RefreshCw size={16} /> Sync missing keys
      </Button>
    </Panel>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [identity, setIdentity] = useState<CryptoIdentity | null>(null);
  const [status, setStatus] = useState<Status>(null);

  const loadProfile = useCallback(async (nextSession: Session | null) => {
    if (!nextSession) {
      setProfile(null);
      return;
    }

    const { data, error } = await supabase.from('profiles').select('*').eq('id', nextSession.user.id).single<Profile>();
    if (error) throw error;
    setProfile(data);
  }, []);

  useEffect(() => {
    if (!hasSupabaseConfig) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      void loadProfile(data.session).catch((error: unknown) => {
        setStatus({ tone: 'error', text: error instanceof Error ? error.message : 'Profile load failed.' });
      });
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setIdentity(null);
      void loadProfile(nextSession).catch((error: unknown) => {
        setStatus({ tone: 'error', text: error instanceof Error ? error.message : 'Profile load failed.' });
      });
    });

    return () => data.subscription.unsubscribe();
  }, [loadProfile]);

  async function signOut() {
    setIdentity(null);
    setProfile(null);
    await supabase.auth.signOut();
  }

  if (!hasSupabaseConfig) return <SetupNotice />;

  if (!session) {
    return (
      <>
        <AuthScreen onStatus={setStatus} />
        <FloatingStatus status={status} />
      </>
    );
  }

  if (!profile) {
    return (
      <div className="grid min-h-screen place-items-center bg-grid font-mono text-cyan-100">
        Loading profile...
      </div>
    );
  }

  if (profile.disabled_at) {
    return (
      <div className="grid min-h-screen place-items-center bg-grid p-4 text-cyan-50">
        <Panel className="max-w-md p-5">
          <h1 className="mb-2 font-mono text-2xl font-bold">account disabled</h1>
          <p className="mb-4 text-slate-400">This CyberChat identity can no longer enter the mesh.</p>
          <Button variant="ghost" onClick={() => void signOut()}>
            <LogOut size={16} /> Sign out
          </Button>
        </Panel>
      </div>
    );
  }

  if (!identity) {
    return (
      <>
        <VaultUnlock onUnlock={setIdentity} onStatus={setStatus} />
        <FloatingStatus status={status} />
      </>
    );
  }

  return (
    <>
      <AppShell
        session={session}
        profile={profile}
        identity={identity}
        onSignOut={() => void signOut()}
        onStatus={setStatus}
      />
      <FloatingStatus status={status} />
    </>
  );
}

function FloatingStatus({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2">
      <StatusLine status={status} />
    </div>
  );
}
