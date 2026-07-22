# Elelany Messenger

A real-time 1-to-1 and group messenger built with React + Vite + TypeScript and Supabase
(Postgres, Auth, Realtime, Storage). Features: private and group chats, reactions, read
receipts, rich-text composer, stickers, animated emojis, screenshot editor, file attachments,
and 1-to-1 voice/video calls (WebRTC).

> **Lost the project folder, or picking this up cold?** Start with
> [`RECOVERY.md`](RECOVERY.md) — where everything lives, which secrets exist and
> how to rebuild from nothing. For *why* the code looks the way it does, read
> [`docs/project-notes.md`](docs/project-notes.md) before changing row level
> security or the Electron window behaviour.

## 1. Prerequisites

- Node.js 18+ and npm
- A free Supabase project — https://supabase.com

## 2. Create the database

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
   This creates all tables, row-level-security policies, RPC functions, realtime channels,
   and the `avatars` + `chat-uploads` storage buckets. It is safe to re-run.

## 3. Configure credentials

1. In Supabase: **Project Settings → API**. Copy the **Project URL** and the **anon public** key.
2. In this folder:

   ```bash
   cp .env.example .env
   ```

3. Edit `.env`:

   ```
   VITE_SUPABASE_URL=https://YOUR-PROJECT-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```

## 4. Run it

```bash
npm install
npm run dev
```

Open the printed URL (default http://localhost:5173). Create an account, then create a
second account in another browser/incognito window to chat between two users.

## 5. Notes

- **Email confirmation:** By default Supabase may require email confirmation. For quick local
  testing, disable it under **Authentication → Providers → Email → Confirm email = off**.
- **Contacts privacy:** A user only appears in "New chat" once you already share a conversation.
  To start the very first chat between two brand-new accounts, one user invites the other by
  email, or you can seed a shared conversation manually.
- **Animated emojis** load from an external public Supabase bucket URL hard-coded in `App.tsx`
  (`ANIMATED_EMOJI_MANIFEST_URL`). They work as long as that public bucket is reachable; they are
  independent of your own project. To host your own, create an `animated-emojis` public bucket,
  upload a `manifest.json` + assets, and update those two constants in `src/App.tsx`.
- **Calls** use WebRTC with public STUN servers. They work across most networks; strict NATs may
  need a TURN server (not included).

## Project structure

```
.
├── index.html
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── .env.example
├── src/
│   ├── App.tsx            # the full messenger UI + logic
│   ├── main.tsx           # React entry
│   ├── index.css          # Tailwind entry
│   ├── supabaseClient.ts  # Supabase client (reads .env)
│   └── types.ts           # shared DB row types
└── supabase/
    └── schema.sql         # run this in Supabase SQL Editor
```
