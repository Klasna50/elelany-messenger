# Elelany Desktop — build and update guide

The desktop app is Electron wrapping the same React app you deploy to Netlify.
The web bundle is packaged **inside** the app, so it works offline-shell and starts instantly.

---

## 1. How auto-update works

```
you bump version -> push git tag -> GitHub Actions builds mac + win
      -> uploads installers + latest.yml / latest-mac.yml to GitHub Releases
      -> installed apps check that feed, download in background, prompt to restart
```

`electron-updater` (wired up in `electron/main.cjs`) checks for updates:

- once on app start,
- every 6 hours while running,
- and from the menu: **Elelany -> Check for Updates…** (mac) / **File -> Check for Updates…** (win).

When a newer version is found it downloads silently, then shows a dialog:
**"Elelany X.Y.Z is ready to install — Restart now / Later."**
If the user picks *Later*, it installs automatically on next quit.

**Users never re-download the app manually. They just get the update.**

---

## 2. One-time setup

### a) Create the GitHub repo

```bash
cd "/Users/v/Downloads/ELELANY 19.07.2026"
git init
git add .
git commit -m "Elelany desktop app"
gh repo create elelany-messenger --private --source=. --push
# or create it on github.com and: git remote add origin <url> && git push -u origin main
```

### b) Point the updater at your repo

In `package.json` -> `build.publish`, replace the placeholder:

```json
"publish": [
  { "provider": "github", "owner": "YOUR-GITHUB-USERNAME", "repo": "elelany-messenger" }
]
```

> This must be correct **before** you ship v1.0.0 to anyone — it is compiled into
> the app as the update feed URL. Existing installs can't be redirected later.

### c) Add repository secrets

GitHub repo -> Settings -> Secrets and variables -> Actions -> New repository secret:

| Secret | Value | Required |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | your Supabase project URL | yes |
| `VITE_SUPABASE_ANON_KEY` | your Supabase anon key | yes |
| `MAC_CSC_LINK` | base64 of your Developer ID `.p12` | yes for mac auto-update |
| `MAC_CSC_KEY_PASSWORD` | the `.p12` export password | yes for mac auto-update |
| `APPLE_ID` | your Apple ID email | for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | from appleid.apple.com | for notarization |
| `APPLE_TEAM_ID` | `S6DVKRF7MY` | for notarization |
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` | Windows signing cert | optional |

Export the mac certificate to base64:

```bash
# Keychain Access -> export "Developer ID Application" as Certificates.p12, then:
base64 -i Certificates.p12 | pbcopy   # paste as MAC_CSC_LINK
```

---

## 3. Shipping an update (the normal loop)

```bash
# 1. make your code changes, then bump the version
npm version patch      # 1.0.0 -> 1.0.1   (or: minor / major)

# 2. push code + tag
git push && git push --tags
```

That's it. The tag push triggers `.github/workflows/release.yml`, which builds on
real macOS and Windows runners and publishes to GitHub Releases.

> **The version number is what triggers updates.** An app only updates if the
> released version is *higher* than what it's running. Never re-tag the same version.

### Release notes
Edit the GitHub Release description — it's shown by the updater on platforms that support it.

---

## 4. Local builds (no CI)

```bash
npm run app:mac     # -> release/*.dmg  + *.zip  (signed with your Developer ID)
npm run app:win     # -> release/Elelany-Setup-x.y.z.exe
npm run app:all     # both
npm run app:dir     # fast unpacked build for testing
npm run release     # build both AND publish to GitHub Releases
```

Local dev with hot reload:
```bash
npm run dev                # terminal 1
npm run electron:dev       # terminal 2
```

---

## 5. Signing — what happens if you skip it

| | Signed | Unsigned |
| --- | --- | --- |
| **macOS** | Installs cleanly. **Auto-update works.** | "Unidentified developer" warning; user must right-click -> Open. **Auto-update silently fails.** |
| **Windows** | Installs cleanly. | SmartScreen "unrecognized app" warning; user clicks *More info -> Run anyway*. Auto-update still works. |

You already have a **Developer ID Application** certificate (Team `S6DVKRF7MY`), so
macOS is covered — just add the secrets above. Notarization is a separate step that
removes the warning entirely; without it users see a Gatekeeper prompt on first launch.

Windows code-signing certificates cost money (~$100-400/yr from Sectigo, DigiCert, etc.).
Auto-update works without one; users just see a one-time SmartScreen warning.

---

## 6. Native features enabled by the desktop app

`electron/preload.cjs` exposes `window.elelany` / `window.electronAPI`, which
`App.tsx` already looks for:

- `startScreenSnip()` — real OS-level drag-to-select screen capture (like Cmd+Shift+4).
  In the browser this falls back to the screen-share permission prompt.
- `captureWindow()` — captures the app window with no permission prompt.

On macOS the first screen snip asks for **System Settings -> Privacy & Security ->
Screen Recording**. Camera and microphone permissions for calls are declared in
`build/entitlements.mac.plist` and the `extendInfo` block of `package.json`.

---

## 7. App icon (recommended before shipping)

Builds currently use the default Electron icon. To use your own, add a
**1024x1024 PNG** at `build/icon.png` — electron-builder generates `.icns` and
`.ico` automatically. Then rebuild.
