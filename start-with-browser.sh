#!/bin/bash

# Start Next.js dev server and open browser to localhost:3000

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

have_npm() {
  command -v npm >/dev/null 2>&1 && return 0
  PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"
  command -v npm >/dev/null 2>&1 && return 0
  [ -x /bin/zsh ] && /bin/zsh -ilc 'command -v npm' >/dev/null 2>&1 && return 0
  [ -x /bin/bash ] && /bin/bash -lc 'command -v npm' >/dev/null 2>&1 && return 0
  return 1
}

if ! have_npm; then
  cat >&2 <<'EOF'
❌ Node.js / npm not found.

This app is a Next.js project. macOS does not include Node — you need to install it once.

  Easiest on a new Mac:
    1) Open https://nodejs.org and install the LTS version (.pkg).
    2) Quit Terminal completely, open it again (so PATH updates).
    3) In this folder run:  npm install
    4) Run your ANT.command shortcut again.

  Or with Homebrew (after https://brew.sh ):
    brew install node
    Then: npm install   in this project folder.

Required: Node 20.9+ (see package.json "engines").
EOF
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "❌ Dependencies not installed (no node_modules/)." >&2
  echo "   In Terminal: cd \"$SCRIPT_DIR\" && npm install" >&2
  exit 1
fi

echo "🚀 Starting Next.js dev server..."
# Terminal.app + osascript "do script" often starts bash with a minimal PATH.
if command -v npm >/dev/null 2>&1; then
  npm run dev &
elif [ -x /bin/zsh ]; then
  /bin/zsh -ilc "cd \"$SCRIPT_DIR\" && exec npm run dev" &
elif [ -x /bin/bash ]; then
  /bin/bash -lc "cd \"$SCRIPT_DIR\" && exec npm run dev" &
else
  echo "❌ npm not found and could not bootstrap via zsh/bash." >&2
  exit 1
fi
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
