# Agent Network Studio

> Observe, compose, compare, and test your agent networks — from Anypoint to production.

Agent Network Studio is a self-hostable workspace for working with MuleSoft Anypoint **agent networks**. It runs as a Next.js web app and as an optional **Electron desktop app** that adds a local Build & Publish lifecycle backed by the Anypoint CLI.

We ship **source, not signed installers**. Clone the repo, review it, build it on your own machine, and run exactly what you compiled — your project files and credentials never leave your machine.

## Read-only mirror

This repository is **public for source access only**. You may clone, review, and build it locally, but **`main` is not open for contributions** — pull requests and issues are not accepted. Changes are made by the maintainer only. Fork for your own experiments if you need a writable copy.

## Features

- **Tracer** — observe and inspect agent-network activity.
- **Builder** *(beta)* — a visual graph editor for composing agent networks, with guided help, one-click examples, and validation designed to reduce misunderstanding.
- **Exchange compare** — diff and reconcile assets across Anypoint Exchange.
- **LLM Proxy** — route and inspect model traffic.
- **Build & Publish** *(desktop only)* — run the Anypoint CLI (`build`, `publish`, `deploy`) against local project folders. Browsers can't spawn a CLI or read your disk, so this lives in the Electron app.

## Architecture

The web app is a standard [Next.js](https://nextjs.org/) (App Router) application. The desktop app runs that same Next.js server as a local child process and points a native Electron window at `http://localhost:3000`, plus a privileged main process that can spawn the Anypoint CLI. Port `3000` is pinned because the Anypoint Connected App registers `http://localhost:3000/auth/callback` as its OAuth redirect URI.

## Quick start (web)

Prerequisites: **Node.js ≥ 20.9**.

```bash
git clone https://github.com/MuleSoft-Forge/mulesoftforge-agent-network-tracer.git
cd mulesoftforge-agent-network-tracer
npm install
cp .env.example .env.local   # then fill in your credentials
npm run dev
```

Open http://localhost:3000.

To generate a session secret:

```bash
openssl rand -base64 32
```

## Desktop app (Build & Publish)

The Build & Publish lifecycle requires the desktop build. See **[BUILD-DESKTOP.md](./BUILD-DESKTOP.md)** for the full guide. The short version (macOS):

```bash
npm install
SESSION_SECRET=$(openssl rand -base64 48) npm run electron:install-local
```

This produces a local `.app`, installs it to `/Applications`, and creates a Desktop shortcut. On Windows, use `npm run electron:dist` for an NSIS installer.

## Configuration

All configuration is via environment variables. Copy [`.env.example`](./.env.example) to `.env.local` and fill in:

| Variable | Required | Description |
| --- | --- | --- |
| `ANYPOINT_CLIENT_ID` | yes | OAuth Connected App client ID |
| `ANYPOINT_CLIENT_SECRET` | yes | OAuth Connected App client secret (server-side, not a password) |
| `SESSION_SECRET` | yes | Encrypts the session cookie (`openssl rand -base64 32`) |
| `ANYPOINT_REDIRECT_URI` | no | Must match your Connected App; defaults to localhost callback |
| `ANYPOINT_BASE_URL` | no | Control-plane base URL (US by default) |

See [`.env.example`](./.env.example) for optional multi-region and desktop settings.

You'll need an Anypoint Platform **Connected App** (App type) with appropriate scopes. The public build does **not** bake any credentials into the binary — you always supply your own.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Production build |
| `npm test` | Run the composer test suite |
| `npm run check` | Type-check, lint, and test |
| `npm run electron:dev` | Run the desktop app with hot reload |
| `npm run electron:install-local` | Build and install the desktop app (macOS) |

## Security

Never commit `.env.local`, `.env.bundled`, or credential files — these are gitignored. See [SECURITY.md](./SECURITY.md) for the security model.

## Third-party content

Builder bundles official Agent Fabric JSON Schemas and a public MuleSoft example
project. Provenance, upstream URLs, and license notes are in
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). Refresh schemas with
`npm run sync:anf-schemas` (clones the public upstream repo when
`ANF_SCHEMA_SOURCE` is unset).

## License

Licensed under the [Apache License 2.0](./LICENSE).
