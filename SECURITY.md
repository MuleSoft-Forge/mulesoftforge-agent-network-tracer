# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability, please report it privately rather than
opening a public issue. Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository (Security → Report a vulnerability), or contact the
maintainers directly.

Please include enough detail to reproduce the issue. We'll acknowledge your
report and keep you informed as we investigate and address it.

## Security model

Agent Network Studio is designed to keep credentials scoped to your controlled infrastructure:

- **You supply your own credentials.** The application reads OAuth Connected App
  credentials from environment variables at runtime. The public build does
  **not** bake any client secrets into published source artifacts.
- **Secrets are gitignored.** `.env`, `.env.local`, `.env.bundled`, and
  `scripts/credentials.json` are excluded from version control. Never commit them.
- **Sessions are encrypted.** The session cookie is encrypted with
  `SESSION_SECRET` via [iron-session](https://github.com/vvo/iron-session).
  Generate a strong value (`openssl rand -base64 32`) and keep it private.
- **Lifecycle runs on your worker tier.** Build & Publish jobs are queued and
  executed by your configured worker process. Keep worker runtime credentials
  and Redis access scoped to trusted infrastructure only.
- **Debug endpoints are development-only.** Routes under `app/api/auth/debug/*`
  return `404` unless `NODE_ENV === "development"`.
- **Bug reports are opt-in.** The floating bug icon can attach a description,
  optional screenshot, route/version metadata, and recent console errors to a
  GitHub Issue when `GITHUB_FEEDBACK_TOKEN` is configured. Users must confirm
  the report contains no customer secrets. Do not include tokens or raw API
  bodies in reports.

## Handling credentials

- Create a dedicated Anypoint **Connected App** (App type) and grant only the
  scopes you need.
- `ANYPOINT_CLIENT_SECRET` is a server-side OAuth client secret, not a user
  password. Rotate it if you suspect exposure.
- When self-hosting, store secrets in your platform's secret manager rather than
  committing them to any file.

## Supported versions

This is an actively developed project; security fixes are applied to the latest
`main` branch. Please build from the latest source.
