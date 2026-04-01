#!/usr/bin/env bash
# Deploy to Vercel production, then point custom domains at THIS deployment.
# Run from repo root after `vercel login` (or with VERCEL_TOKEN set).
# Without the explicit `vercel alias set` step, *.vercel.app can update while
# agentnetworktracer.com still serves an older deployment.

set -euo pipefail
cd "$(dirname "$0")/.."

FORCE=()
if [[ "${1:-}" == "--force" ]]; then
  FORCE=(--force)
fi

DOMAINS=(
  "agentnetworktracer.com"
  "www.agentnetworktracer.com"
)

echo ">>> Deploying to production (${FORCE[*]:-no --force})..."
OUT=$(npx vercel deploy --prod --yes "${FORCE[@]}" 2>&1) || {
  echo "$OUT"
  exit 1
}
echo "$OUT"

# Prefer a stable URL line from CLI output
URL=$(echo "$OUT" | grep -oE 'https://[a-zA-Z0-9_.-]+\.vercel\.app' | tail -1 || true)
if [[ -z "${URL:-}" ]]; then
  # Some CLI versions print only the deployment URL on the last line
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
