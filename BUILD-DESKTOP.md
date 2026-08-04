# Build the desktop app locally

Agent Network Studio’s **Build & Publish** lifecycle (Anypoint CLI `build`, `publish`, `deploy`) runs only in the **Electron desktop app**. Browsers cannot spawn the CLI or access project folders on disk.

We ship **source**, not a signed installer. Clone the repo, build on your machine, and run what you compiled — your project files and credentials stay local.

## Prerequisites

- **Node.js** ≥ 20.9 (`node -v`)
- **macOS** (Windows: `npm run electron:dist` for an NSIS installer)
- **Anypoint CLI v4** with the agent-fabric plugin (`anypoint-cli-v4 plugins list`)
- A **`.env.local`** in the repo root with your Connected App IDs (`ANYPOINT_CLIENT_ID`, etc.)

## One-command install (macOS)

From the repo root:

```bash
npm install
SESSION_SECRET=$(openssl rand -base64 48) npm run electron:install-local
```

This will:

1. Run a production Next.js build
2. Assemble the standalone server bundle
3. Package the Electron app
4. Install **Agent Network Tracer.app** to `/Applications`
5. Create a Desktop shortcut

Launch from the Desktop or Applications folder.

## Development (hot reload)

```bash
npm run electron:dev
```

Runs `next dev` and Electron together. Port **3000** is pinned (OAuth redirect URI).

## First-run config

On first launch, the app creates config under:

- **macOS:** `~/Library/Application Support/Agent Network Tracer/`
- **Windows:** `%APPDATA%\Agent Network Tracer\`

Add Anypoint credentials to the `.env` template there only if you use Connected App sign-in (SSO orgs). Password sign-in does not require it.

Session encryption uses a generated `session-secret` file — never commit it.

## Stay signed in (desktop)

When you sign in with your Anypoint username and password, check **Stay signed in** (on by default) to save credentials in your OS secure keychain (macOS Keychain / Windows DPAPI). The app silently re-authenticates before your access token expires (~1 hour) and on the next launch — no Connected App required.

Use **Clear saved settings** in the user menu to remove stored credentials, end your session, and clear local preferences (remembered project path, etc.). **Sign out** ends the current session only; saved credentials remain for the next app launch unless you clear them.

## Troubleshooting

| Issue | Fix |
| --- | --- |
| Port 3000 in use | Quit other copies of the app, or stop `npm run dev` |
| Gatekeeper blocks the app | Expected for unsigned local builds — right-click → Open, or build yourself from source |
| Build fails on `SESSION_SECRET` | Export `SESSION_SECRET` (≥32 chars) before `npm run build` |
| CLI not detected | Install `anypoint-cli-v4` and the agent-fabric plugin; click **Re-check** in Build & Publish |

## How it works

The desktop app runs the real Next.js server as a local child process and points a native window at `http://localhost:3000` — the same app that runs on the web, plus a privileged main process that can spawn the Anypoint CLI. The port is pinned to `3000` because the Anypoint Connected App registers `http://localhost:3000/auth/callback` as its OAuth redirect URI.

## Privacy

- **Web app:** Tracer, Builder (beta), Exchange compare, LLM Proxy — hosted; read-only where applicable.
- **Desktop app:** Build & Publish runs the Anypoint CLI against **local project folders**. Nothing is uploaded to Agent Network Studio servers for lifecycle commands.
- **Credentials:** The public build does **not** bake OAuth client secrets (`BAKE_CLIENT_SECRETS=0` is the default). You supply your own Connected App credentials via `.env.local` at build time or the app's userData `.env` at runtime.
