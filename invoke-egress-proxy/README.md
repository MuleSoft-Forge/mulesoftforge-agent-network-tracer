# invoke-egress-proxy

A tiny authenticated relay, deployed separately on Vercel, that gives the main
app's **Invoke** feature a second egress path for outbound broker calls.

## Why this exists

Some A2A brokers (CloudFront/WAF-fronted sandbox environments in particular)
block requests from third-party hosting providers by IP reputation — Fly.io's
IPs get a clean `403` from CloudFront, while requests from AWS's own IP space
go through. Vercel serverless functions run on AWS Lambda, so relaying through
one gives Invoke a working path to those brokers without weakening CORS or
moving the whole feature client-side (many brokers don't set permissive CORS
headers anyway, so a direct browser→broker fetch wouldn't work either).

The main app tries the broker directly first — this is a fallback, not the
primary route, so the common case (a broker with no IP restriction) pays no
extra latency or hop.

## Contract

`POST /api/proxy`, header `x-proxy-secret: <PROXY_SHARED_SECRET>`:

```json
{ "url": "https://...", "method": "GET", "headers": {}, "body": "...", "timeoutMs": 5000 }
```

Response:

```json
{ "status": 200, "statusText": "OK", "headers": {...}, "body": "..." }
```

or `{ "error": "..." }` with a 4xx/5xx if the proxy itself rejects the request
(bad secret, unsafe URL, upstream failure).

## Deploying

```
cd invoke-egress-proxy
vercel deploy --prod
```

Linked to the `mulesoftforge` Vercel team as project `invoke-egress-proxy`,
aliased to `https://invoke-egress-proxy.vercel.app`. `maxDuration` is set to
300s — the max this plan allows without an Enterprise upgrade — since some
agent turns take close to a minute; keep `MAX_TIMEOUT_MS` in `api/proxy.ts`
comfortably under whatever `maxDuration` is set to.

## Config

- **Here** (Vercel project env var): `PROXY_SHARED_SECRET`.
- **Main app** (Fly secrets): `INVOKE_PROXY_URL` (this deployment's `/api/proxy`
  URL) and `INVOKE_PROXY_SECRET` (same value as `PROXY_SHARED_SECRET`). Invoke
  degrades to direct-only fetches when these are unset — nothing here is
  required for local dev.
