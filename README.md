# CyberChat

Invite-only encrypted group chat built with React, Vite, TypeScript, Supabase, and Web Crypto.

## Local Setup

1. Create a Supabase project.
2. Run `supabase/migrations/001_cyberchat_v1.sql` in the Supabase SQL editor.
3. In Supabase Auth settings, disable email confirmation for the simplest username/password MVP flow.
4. Copy `.env.example` to `.env` and fill in:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_INITIAL_ADMIN_USERNAME=admin
```

5. Install and run:

```bash
npm install
npm run dev
```

The first account whose username matches `VITE_INITIAL_ADMIN_USERNAME` becomes admin. The SQL migration also defaults the first admin username to `admin`; if you change the env value, update `public.app_settings.initial_admin_username` in Supabase too.

## Security Model

- Messages are encrypted in the browser with AES-GCM before they are stored.
- User private ECDH keys are wrapped with a vault passphrase using PBKDF2-SHA-256 and AES-GCM.
- Room keys are wrapped per member using ECDH-derived AES-GCM keys.
- Supabase stores ciphertext, encrypted room keys, and encrypted private-key vaults.
- Supabase RLS restricts rooms, memberships, messages, reactions, invites, and vault rows.

## Deploy

- Deploy the frontend to Netlify.
- Add the same `VITE_*` environment variables in Netlify.
- Keep Supabase service-role keys out of the frontend.
