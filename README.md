# Agent Network Tracer

Observability tool for MuleSoft Agent Fabric. Visualize your agent network, monitor broker tasks, and trace execution flows.

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create `.env.local` file with required environment variables (see below)

3. Start development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000)

## Environment Variables

### Required

- `ANYPOINT_CLIENT_ID` - OAuth client ID for US region
- `ANYPOINT_CLIENT_SECRET` - OAuth client secret for US region
- `SESSION_SECRET` - Session encryption key (generate with: `openssl rand -base64 32`, minimum 32 characters)

### Optional (Multi-Region Support)

- `ANYPOINT_EU_CLIENT_ID` / `ANYPOINT_EU_CLIENT_SECRET` - EU region credentials
- `ANYPOINT_CA_CLIENT_ID` / `ANYPOINT_CA_CLIENT_SECRET` - CA region credentials
- `ANYPOINT_JP_CLIENT_ID` / `ANYPOINT_JP_CLIENT_SECRET` - JP region credentials

### Optional (OAuth Configuration)

- `ANYPOINT_REDIRECT_URI` - OAuth redirect URI (defaults to `${VERCEL_URL}/auth/callback` in production)
- `ANYPOINT_BASE_URL` - Anypoint Platform base URL (defaults to `https://anypoint.mulesoft.com`)

### Optional (Debugging)

- `ENABLE_API_LOGGING` - Set to `"true"` or `"1"` to enable API request logging (disabled by default)

## Privacy Policy

See [Privacy Policy & Terms of Use](/privacy) for information about data handling and privacy.

## Deployment

This project is deployed on Vercel. Environment variables must be configured in the Vercel dashboard.

## Status

Personal Project (Unofficial) - Not an official MuleSoft/Salesforce product.
