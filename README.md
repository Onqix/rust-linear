# Linear Pulse (`rust-linear`)

A custom Ubuntu desktop Linear command center built with **Tauri v2 (Rust + React + Tailwind CSS)** featuring:

- **Latest Items**: Fast, searchable feed of your Linear issues sorted by `updatedAt`, filterable by team.
- **Unread Responses**: Tracks `last_seen_at` per issue in local SQLite so you immediately see when teammates reply.
- **Claude Haiku AI Triage**: Ranks the **next tickets to grab** and organizes active tickets into actionable work buckets (*Needs Your Reply*, *Quick Wins*, *Deep Work*, *Blocked / Waiting*).
- **One-Click In-App Updates**: Built-in **Update App** button powered by `tauri-plugin-updater` that pulls signed `.AppImage` updates directly from GitHub Releases.

---

## 1. One-Time GitHub & Updater Setup

1. **Create the GitHub repo** from `/srv/repos/rust-linear`:
   ```bash
   git add .
   git commit -m "Initial scaffold: Linear Pulse"
   gh repo create rust-linear --private --source=. --remote=origin --push
   ```
   *(If you use a private repo, note that GitHub Releases updater endpoints require either a public repo or an authenticated proxy; a public repo works out-of-the-box with `latest.json`.)*

2. **Generate a Tauri signing keypair** (for the in-app Update button):
   ```bash
   npx tauri signer generate -w ~/.tauri/rust-linear.key
   ```
   - Copy the **public key** into `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.
   - Replace `OWNER` in `src-tauri/tauri.conf.json` (`plugins.updater.endpoints`) with your GitHub username.
   - Add the **private key** contents as a GitHub Actions secret named `TAURI_SIGNING_PRIVATE_KEY` (and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if you set a password):
     ```bash
     gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/rust-linear.key
     ```

---

## 2. Publish a Release from This Server

Whenever you push a new version (bump `version` in `package.json` and `src-tauri/tauri.conf.json`, then tag):

```bash
git add -A && git commit -m "Release v0.1.0"
git tag v0.1.0
git push origin main --tags
```

GitHub Actions (`.github/workflows/release.yml`) will build the Linux `.AppImage` and `.deb`, sign the updater bundle, and publish `latest.json` on the GitHub Release.

---

## 3. Install & Update on Your Ubuntu Desktop

1. Download the `.AppImage` from your GitHub Releases page (or with `gh release download --pattern '*.AppImage'`).
2. Make it executable and run it:
   ```bash
   chmod +x Linear*.AppImage
   ./Linear*.AppImage
   ```
3. Open **Settings & API Keys** in the bottom-left sidebar and enter:
   - **Linear Personal API Key** (Linear → Settings → Security & Access → Personal API keys)
   - **Anthropic API Key** (Anthropic Console)
4. Whenever you push a new `v*` tag from this server, click **Update App** in the sidebar to download, install, and relaunch into the new version.
