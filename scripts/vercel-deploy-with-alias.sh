#!/usr/bin/env bash
# Deploy to Vercel production, then point custom domains at THIS deployment.
# Run from repo root after `vercel login` (or with VERCEL_TOKEN set).
# Without the explicit `vercel alias set` step, *.vercel.app can update while
# agentnetworktracer.com still serves an older deployment.

set -euo pipefail
cd "$(dirname "$0")/.."

DOMAINS=(
  "agentnetworktracer.com"
  "www.agentnetworktracer.com"
)

if [[ "${1:-}" == "--force" ]]; then
  echo ">>> Deploying to production (--force)..."
  OUT=$(npx vercel deploy --prod --yes --force 2>&1) || {
    echo "$OUT"
    exit 1
  }
else
  echo ">>> Deploying to production..."
  OUT=$(npx vercel deploy --prod --yes 2>&1) || {
    echo "$OUT"
    exit 1
  }
fi
echo "$OUT"

# Prefer a stable URL line from CLI output
URL=$(echo "$OUT" | grep -oE 'https://[a-zA-Z0-9_.-]+\.vercel\.app' | tail -1 || true)
if [[ -z "${URL:-}" ]]; then
  URL=$(echo "$OUT" | awk 'NF { line = $0 } END { print line }' | tr -d '\r' | grep -oE 'https://[a-zA-Z0-9_.-]+\.vercel\.app' || true)
fi

if [[ -z "${URL:-}" ]]; then
  echo ">>> ERROR: Could not parse deployment URL from Vercel output. Set it manually, then run:"
  for d in "${DOMAINS[@]}"; do
    echo "    npx vercel alias set <DEPLOYMENT_URL> $d"
  done
  exit 1
fi

echo ">>> Aliasing custom domains to: $URL"
for d in "${DOMAINS[@]}"; do
  npx vercel alias set "$URL" "$d"
done

echo ">>> Done. Custom domains should now serve this deployment. Hard-refresh browsers (e.g. Cmd+Shift+R)."
