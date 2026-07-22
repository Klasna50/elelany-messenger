# Recovery

What to do if this folder is gone, the computer died, or someone else has to
pick the project up. No secret values are written here — only where each one
comes from.

## Where everything actually lives

| Thing | Where it really is | Safe if this machine dies? |
|---|---|---|
| Source code, SQL, CI config | GitHub `Klasna50/elelany-messenger` | Yes |
| Every released version | GitHub Releases (tags `v*`) | Yes |
| All user data — accounts, messages, groups, uploads | Supabase project `ddsuhlptcpihdmcwacns` | Yes |
| The website | Netlify project `elelany-messenger` | Yes |
| `.env` | This machine only, gitignored | **No** — recreate, see below |
| Apple Developer ID certificate (`.p12`) | Your keychain / your own backup | **No** — see below |
| Build output (`dist/`, `release/`, `node_modules/`) | Generated | Doesn't matter |

The short version: the code and the data are both off this machine. What is
*not* backed up is the `.env` file and the signing certificate.

## Restoring the project from nothing

```bash
git clone https://github.com/Klasna50/elelany-messenger.git
cd elelany-messenger
npm install
cp .env.example .env      # then fill in the two values below
npm run dev               # http://localhost:5173
```

`.env` needs exactly two values, both from
**Supabase → Project Settings → API**:

- `VITE_SUPABASE_URL` — the Project URL
- `VITE_SUPABASE_ANON_KEY` — the `anon` / public key

The anon key is safe to ship in the app; every table is protected by row level
security, so it grants nothing on its own. It is kept out of git only so the
project's identity isn't hardcoded, not because it is a secret.

## GitHub Actions secrets

Set at **Settings → Secrets and variables → Actions**. Note that GitHub
secrets are **write-only** — you cannot read them back, so this list is a
recipe for regenerating them, not a backup.

| Secret | Where it comes from | Needed for |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase → Settings → API | Every build |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Settings → API | Every build |
| `MAC_CSC_LINK` | Your Developer ID `.p12`, base64-encoded | Mac signing |
| `MAC_CSC_KEY_PASSWORD` | The password you set when exporting the `.p12` | Mac signing |
| `APPLE_ID` | Your Apple developer account email | Notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | appleid.apple.com → Sign-In and Security | Notarization |
| `APPLE_TEAM_ID` | Apple Developer → Membership | Notarization |
| `NETLIFY_AUTH_TOKEN` | Netlify → User settings → Applications | Web deploy |
| `NETLIFY_SITE_ID` | Netlify → Site configuration (`647193fa-bdc5-41d1-8e8b-cffcf9a7d978`) | Web deploy |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Not set — no Windows cert yet | Optional |

`GITHUB_TOKEN` is provided automatically; you never create it.

Without a Windows certificate, the installer shows a SmartScreen warning on
first run. That is expected, not a build failure.

### The Apple certificate is the one real single point of failure

`MAC_CSC_LINK` cannot be read back out of GitHub. If this machine's keychain
is lost and you have no copy of the `.p12` file elsewhere, the certificate is
gone and **macOS releases stop working** — auto-update on macOS requires a
signed build.

It is recoverable: revoke the old certificate at
developer.apple.com/account → Certificates, create a new Developer ID
Application certificate, export it as `.p12`, then re-set `MAC_CSC_LINK`
(base64 of the file) and `MAC_CSC_KEY_PASSWORD`. It costs an afternoon and
blocks Mac releases until done.

**Keep a copy of the `.p12` somewhere that is not this laptop** — a password
manager or an encrypted backup. Not email, not the Desktop.

## Database

`supabase/schema.sql` is the whole backend and is safe to re-run: it drops and
recreates policies and functions in place. Running it against an empty project
rebuilds tables, row level security, functions, triggers, realtime and storage
buckets from scratch. `supabase/verify.sql` then reports OK/MISSING per item.

The other files in `supabase/` are one-off migrations and audits already
applied to the live database. Each one has been folded back into `schema.sql`,
so **a fresh install needs `schema.sql` and nothing else**. They are kept only
so the history of each change is readable.

If you add a migration later, fold it into `schema.sql` at the same time.
Otherwise `schema.sql` quietly stops describing the real database, and a
rebuild silently comes up missing a feature.

**`schema.sql` recreates structure, not data.** Restoring accounts and messages
depends on Supabase's own backups — check what your plan retains
(**Database → Backups**) before you need it.

## Releasing

```bash
npm version patch --no-git-tag-version   # e.g. 1.1.9 -> 1.1.10
git add -A && git commit -m "..."
git tag v1.1.10
git push origin main && git push origin v1.1.10
```

Pushing the tag builds and signs both desktop apps, publishes them to GitHub
Releases, and deploys the website — all from that one tag. Installed apps pick
the update up on their next check. The version must always increase.

To verify a release actually went out:

```bash
curl -sL https://github.com/Klasna50/elelany-messenger/releases/latest/download/latest-mac.yml | head -1
curl -sL https://github.com/Klasna50/elelany-messenger/releases/latest/download/latest.yml | head -1
```

Both should print the new version number.

## If something looks broken in the app

Check *which build* is actually running before debugging the code — a feature
missing from the website is usually a stale deploy, not a bug:

```bash
B=$(curl -s https://elelany-messenger.netlify.app/ | grep -o 'assets/[^"]*\.js' | head -1)
curl -s "https://elelany-messenger.netlify.app/$B" | grep -c "some text from the feature"
```

This exact situation happened once: the site sat five versions behind the
desktop apps because web deploys were manual. That is why the release workflow
now deploys the website too.

## Further reading

- [`docs/project-notes.md`](docs/project-notes.md) — why things are built the
  way they are, and the bugs that were expensive to find. Read this before
  changing row level security or the Electron window behaviour.
- [`DESKTOP.md`](DESKTOP.md) — desktop build, signing and notarization detail.
