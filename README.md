# CyberChat - Secure E2EE Channel

![Cyberpunk Theme](https://img.shields.io/badge/Theme-Cyberpunk-00e5ff?style=flat-square)
![Security](https://img.shields.io/badge/Security-E2EE-34d399?style=flat-square)
![Status](https://img.shields.io/badge/Status-Deployed-success?style=flat-square)

**Live Demo:** [https://cyberchatsecure.netlify.app/](https://cyberchatsecure.netlify.app/)

CyberChat is a highly secure, end-to-end encrypted (E2EE) group chat application designed with a premium, neon-accented cyberpunk aesthetic. It provides users with a zero-knowledge communication channel where messages are only ever decrypted locally in the browser, ensuring total privacy.

## Features

- **End-to-End Encryption (E2EE):** All messages are encrypted locally using AES-GCM before being sent over the network. Keys are wrapped and shared securely using ECDH.
- **Auto-Lock Security:** A background security hook listens for `visibilitychange`. If you switch tabs or minimize the browser, your private encryption key is immediately wiped from memory. A passphrase is required to unlock the vault when you return.
- **Cyberpunk UI:** Features a sleek, glassmorphism-based design with neon glows, CRT scanlines, and terminal-style typography.
- **Invite-Only Access:** Admins create secure channels (rooms) and generate unique invite codes. New users must claim an invite to establish their secure identity and join the network.
- **Real-Time Synchronization:** Messages, reactions, and key shares are delivered instantly using PostgreSQL real-time subscriptions via Supabase.

## Tech Stack

- **Frontend:** React, TypeScript, Vite
- **Styling:** Tailwind CSS (Vanilla utilities with custom CSS keyframes and glassmorphism)
- **Backend/Database:** Supabase (PostgreSQL, Row Level Security, Realtime Publications)
- **Cryptography:** Web Crypto API (Native browser cryptography)
- **Deployment:** Netlify

## Getting Started Locally

1. **Clone the repository** and install dependencies:
   ```bash
   npm install
   ```
2. **Environment Variables:** Set up your `.env` file with your Supabase credentials:
   ```
   VITE_SUPABASE_URL=your-supabase-url
   VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
   ```
3. **Run the development server:**
   ```bash
   npm run dev
   ```

## Security Model

The server (Supabase) only stores encrypted ciphertexts and wrapped room keys. 
- When an Admin creates a room, a unique Room Key is generated.
- The Room Key is encrypted using the Public Key of each member in the room.
- Your Private Key never leaves your browser and is stored securely in an encrypted vault in the database, locked behind a Passphrase that only you know.
- The application clears your Private Key from memory the moment the browser tab loses focus.

---

*Stay secure. Stay encrypted.*
