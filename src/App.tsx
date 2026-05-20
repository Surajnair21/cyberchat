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
          'border-cyan-400/20 bg-slate-950/40 text-cyan-100 hover:border-cyan-300/60 hover:bg-cyan-300/10 hover:glow-border-cyan',
        props.variant === 'danger' &&
          'border-rose-400/40 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20',
        (!props.variant || props.variant === 'primary') &&
          'border-cyan-300/70 bg-cyan-300 text-slate-950 hover:bg-cyan-200 hover:glow-border-cyan',
      )}
    >
      {props.children}
    </button>
  );
}

function Panel(props: { children: React.ReactNode; className?: string }) {
  return (
    <section className={cx('glass-panel rounded-xl', props.className)}>
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
    <div className="grid min-h-screen place-items-center bg-grid p-4 text-cyan-50 relative">
      <div className="scanlines" />
      <Panel className="w-full max-w-lg p-8 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent opacity-70 animate-pulse-glow" />
        
        <div className="mb-10 flex flex-col items-center justify-center gap-4 text-center">
          <div className="flex items-center gap-3 text-cyan-300">
            <Shield size={32} className="animate-pulse-glow" />
            <h1 className="font-mono text-4xl font-bold tracking-[0.2em] uppercase text-white glow-text-cyan">CyberChat</h1>
          </div>
          <div className="rounded border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 font-mono text-xs text-emerald-200 tracking-widest uppercase animate-pulse">
            E2EE Secured Channel
          </div>
        </div>

        <div className="mb-8 grid grid-cols-3 gap-2 rounded border border-cyan-400/15 bg-slate-950/80 p-1">
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
                'h-10 rounded font-mono text-xs font-semibold uppercase tracking-widest transition',
                mode === key ? 'bg-cyan-300 text-slate-950 glow-border-cyan' : 'text-cyan-200/70 hover:bg-cyan-300/10 hover:text-cyan-100',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <form className="grid gap-6" onSubmit={handleAuth}>
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
            {busy ? 'Working...' : mode === 'login' ? 'Establish Connection' : 'Create Secure Identity'}
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
      <div className="scanlines" />
      <Panel className="w-full max-w-md p-8 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent opacity-70 animate-pulse-glow" />
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <div className="relative">
            <div className="absolute inset-0 rounded-full glow-border-cyan opacity-50 animate-ping" style={{ animationDuration: '3s' }} />
            <div className="relative grid size-16 place-items-center rounded-full border border-cyan-400/30 bg-slate-950/80">
              <KeyRound className="text-cyan-300 animate-pulse-glow" size={32} />
            </div>
          </div>
          <div>
            <h1 className="font-mono text-2xl font-bold uppercase tracking-widest glow-text-cyan text-white">Vault Locked</h1>
            <p className="mt-2 text-sm text-cyan-200/60 font-mono">Identity verification required</p>
          </div>
        </div>
        <form className="grid gap-6" onSubmit={unlock}>
          <Field label="Passphrase" type="password" value={passphrase} onChange={setPassphrase} required />
          <Button type="submit" disabled={busy}>
            <Shield size={16} />
            {busy ? 'Decrypting Local Identity...' : 'Initialize Decryption'}
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
  onLock,
  onStatus,
}: {
  session: Session;
  profile: Profile;
  identity: CryptoIdentity;
  onSignOut: () => void;
  onLock: () => void;
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

  // Automated background key sync
  useEffect(() => {
    if (rooms.length === 0 || Object.keys(profiles).length === 0 || Object.keys(roomKeys).length === 0) return;

    const autoSync = async () => {
      try {
        const { data: memberRows, error: membersError } = await supabase
          .from('room_members')
          .select('*')
          .eq('active', true);
        if (membersError) return;

        const { data: shareRows, error: sharesError } = await supabase
          .from('room_key_shares')
          .select('room_id, user_id, key_version');
        if (sharesError) return;

        const shareSet = new Set(
          (shareRows || []).map((share) => `${share.room_id}:${share.user_id}:${share.key_version}`),
        );

        let createdCount = 0;
        for (const room of rooms) {
          const latest = latestRoomKey(roomKeys[room.id]);
          if (!latest) continue;

          const roomMembers = (memberRows || []).filter((member) => member.room_id === room.id);
          for (const member of roomMembers) {
            const shareKey = `${room.id}:${member.user_id}:${latest.version}`;
            const recipient = profiles[member.user_id];
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
            if (!insertError) {
              createdCount += 1;
            }
          }
        }

        if (createdCount > 0) {
          await loadRoomKeys();
        }
      } catch (e) {
        console.error('Background key sync error:', e);
      }
    };

    const timer = setTimeout(() => {
      void autoSync();
    }, 2000); // 2s delay after updates to avoid blocking the main UI thread

    return () => clearTimeout(timer);
  }, [rooms, profiles, roomKeys, members, session.user.id, loadRoomKeys]);

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
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_key_shares', filter: `user_id=eq.${session.user.id}` }, () => {
        void loadRoomKeys();
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
  }, [activeRoom, decryptRows, loadMessages, loadRoomKeys, profile.username, session.user.id]);


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
      await loadMessages();
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
            <Button variant="ghost" onClick={onLock} title="Lock Vault">
              <Shield size={16} className="text-cyan-400" />
              <span className="hidden sm:inline text-cyan-400">Lock</span>
            </Button>
            <Button variant="ghost" onClick={onSignOut} title="Sign out">
              <LogOut size={16} />
              <span className="hidden sm:inline">Exit</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 p-4 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
        <Panel className="overflow-hidden flex flex-col h-[85vh]">
          <div className="border-b border-cyan-400/20 bg-cyan-950/20 p-4 relative">
            <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent opacity-50" />
            <div className="flex items-center gap-2 font-mono text-sm uppercase tracking-[0.2em] text-cyan-300 glow-text-cyan">
              <Radio size={16} className="animate-pulse" /> Channels
            </div>
          </div>
          <div className="grid gap-1 p-3 flex-1 overflow-y-auto">
            {rooms.map((room) => (
              <button
                key={room.id}
                onClick={() => setActiveRoomId(room.id)}
                className={cx(
                  'rounded px-4 py-3 text-left transition group relative overflow-hidden',
                  activeRoom?.id === room.id ? 'bg-cyan-900/40 border border-cyan-400/30 shadow-[inset_0_0_15px_rgba(34,211,238,0.1)]' : 'text-cyan-100/70 border border-transparent hover:bg-cyan-900/20 hover:border-cyan-400/10',
                )}
              >
                {activeRoom?.id === room.id && <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-cyan-400 glow-border-cyan" />}
                <div className={cx('font-mono text-sm font-bold tracking-wide', activeRoom?.id === room.id ? 'text-cyan-300 glow-text-cyan' : 'group-hover:text-cyan-200')}># {room.name}</div>
                <div className="truncate text-xs opacity-60 mt-1">{room.description || 'secure channel'}</div>
              </button>
            ))}
            {rooms.length === 0 && <div className="p-3 text-sm font-mono text-cyan-500/50 uppercase tracking-widest text-center mt-4">No Secure Channels</div>}
          </div>
        </Panel>

        <Panel className="flex h-[85vh] flex-col overflow-hidden relative">
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent opacity-50" />
          <div className="border-b border-cyan-400/20 bg-cyan-950/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-mono text-xl font-bold text-white glow-text-cyan uppercase tracking-widest">
                  {activeRoom?.name ? `// ${activeRoom.name}` : '// UNAUTHORIZED'}
                </h2>
                <p className="text-xs font-mono text-cyan-200/50 uppercase tracking-widest mt-1">
                  {latestKey ? `ENC_KEY_V${latestKey.version} [ACTIVE]` : 'WAITING FOR SYNC...'}
                </p>
              </div>
              <div className="flex items-center gap-2 rounded border border-emerald-400/30 bg-emerald-950/40 px-3 py-1 font-mono text-xs text-emerald-300 tracking-widest shadow-[0_0_10px_rgba(52,211,153,0.1)]">
                <Activity size={14} className="animate-pulse" />
                {presenceList.length + 1} ON
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-5 scroll-smooth">
            {messages.map((message) => {
              const sender = profiles[message.sender_id];
              const mine = message.sender_id === session.user.id;
              return (
                <article
                  key={message.id}
                  className={cx(
                    'rounded-lg border p-4 shadow-sm transition-all hover:shadow-md backdrop-blur-md',
                    mine ? 'border-cyan-400/30 bg-cyan-950/30 ml-8' : 'border-slate-700/50 bg-slate-900/50 mr-8',
                  )}
                >
                  <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-700/50 pb-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2.5 rounded-full shadow-[0_0_5px_currentColor]"
                        style={{ backgroundColor: sender?.avatar_color || '#22d3ee', color: sender?.avatar_color || '#22d3ee' }}
                      />
                      <span className="font-mono text-sm font-semibold text-cyan-200 tracking-wide">
                        {mine ? 'YOU' : `@${sender?.username || 'UNKNOWN'}`}
                      </span>
                    </div>
                    <time className="font-mono text-xs text-slate-500 tracking-widest">
                      {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </time>
                  </div>
                  <p className={cx('whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-200 font-sans tracking-wide', message.failed && 'text-rose-300')}>
                    {message.plaintext}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {reactions.map((reaction) => {
                      const count = reactionsByMessage[message.id]?.filter((item) => item.reaction === reaction).length || 0;
                      return (
                        <button
                          key={reaction}
                          onClick={() => void reactToMessage(message.id, reaction)}
                          className="rounded border border-cyan-400/20 bg-slate-950/80 px-2 py-1 font-mono text-xs text-cyan-100/70 hover:bg-cyan-900/50 hover:text-cyan-100 hover:border-cyan-400/40 transition"
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
              <div className="grid h-full place-items-center text-center text-slate-500">
                <div className="opacity-50">
                  <MessageSquare className="mx-auto mb-4 text-cyan-500/30 animate-pulse" size={48} />
                  <p className="font-mono tracking-[0.2em] uppercase text-sm">No transmissions found</p>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-cyan-400/20 bg-cyan-950/10 p-4 relative">
            <div className="mb-2 h-4 text-xs font-mono tracking-widest text-cyan-500/70 uppercase">
              {typingList.length > 0 ? `> ${typingList.join(', ')} typing...` : '> READY'}
            </div>
            <form className="flex gap-3" onSubmit={sendMessage}>
              <input
                className="min-w-0 flex-1 rounded-md border border-cyan-400/30 bg-slate-950/80 px-4 py-2 font-mono text-sm text-cyan-50 outline-none focus:border-cyan-300/80 focus:shadow-[0_0_15px_rgba(34,211,238,0.2)] transition placeholder:text-slate-600"
                value={draft}
                onChange={(event) => void handleTyping(event.target.value)}
                placeholder={latestKey ? 'Encrypt and transmit...' : 'AWAITING CIPHER KEY'}
                disabled={!latestKey}
              />
              <Button type="submit" disabled={!latestKey || !draft.trim()}>
                <Send size={16} /> <span className="hidden sm:inline">SEND</span>
              </Button>
            </form>
          </div>
        </Panel>

        <aside className="grid gap-6 content-start h-[85vh] overflow-y-auto pr-1">
          <Panel className="p-4 relative">
            <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent opacity-50" />
            <div className="mb-4 flex items-center gap-2 font-mono text-sm uppercase tracking-[0.2em] text-cyan-300 glow-text-cyan">
              <Users size={16} className="animate-pulse" /> Operatives
            </div>
            <div className="grid gap-2">
              {members.map((member) => (
                <div key={member.user_id} className="flex items-center justify-between rounded border border-cyan-400/10 bg-slate-950/60 px-3 py-2 hover:border-cyan-400/30 transition">
                  <div>
                    <div className="font-mono text-sm text-cyan-200">@{profiles[member.user_id]?.username || 'loading'}</div>
                    <div className={cx("text-[10px] font-mono tracking-widest uppercase mt-1", member.active ? 'text-emerald-400/70' : 'text-rose-400/70')}>
                      [{member.active ? 'online' : 'terminated'}]
                    </div>
                  </div>
                  {member.active && profile.role === 'admin' && member.user_id !== session.user.id && (
                    <button
                      className="font-mono text-xs text-rose-300/50 hover:text-rose-200 uppercase tracking-widest transition"
                      onClick={() => void removeMember(member)}
                    >
                      revoke
                    </button>
                  )}
                </div>
              ))}
              {members.length === 0 && <div className="text-xs font-mono text-slate-500 uppercase tracking-widest text-center mt-2">NO DATA</div>}
            </div>
          </Panel>

          {profile.role === 'admin' && (
            <AdminPanel
              profile={profile}
              session={session}
              rooms={rooms}
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
  onRefresh,
  onStatus,
}: {
  profile: Profile;
  session: Session;
  rooms: Room[];
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
    </Panel>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [identity, setIdentity] = useState<CryptoIdentity | null>(null);
  const [status, setStatus] = useState<Status>(null);

  // Tab-switch auto-lock security feature
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        setIdentity(null);
        setStatus({ tone: 'info', text: 'Vault auto-locked for security.' });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

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
      <div className="scanlines" />
      <AppShell
        session={session}
        profile={profile}
        identity={identity}
        onSignOut={() => void signOut()}
        onLock={() => {
          setIdentity(null);
          setStatus({ tone: 'info', text: 'Vault locked manually.' });
        }}
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
