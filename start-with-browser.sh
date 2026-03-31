#!/bin/bash

# Start Next.js dev server and open browser to localhost:3000

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🚀 Starting Next.js dev server..."
npm run dev &
DEV_PID=$!

# Wait for server to be ready
echo "⏳ Waiting for server to start..."
sleep 4

# Open default browser
if command -v open > /dev/null 2>&1; then
  open "http://localhost:3000"
  echo "🌐 Opened http://localhost:3000 in your browser."
else
  echo "🌐 Server running at http://localhost:3000"
fi

# Keep script in foreground so Ctrl+C stops the dev server
wait $DEV_PID
