#!/bin/bash

# Start clean script - Resets everything and starts dev server

set -e

echo "🔄 Starting clean development environment..."

# Run reset first
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$SCRIPT_DIR/reset.sh"

# Wait a moment for ports to be released
sleep 2

# Check if .env.local exists
if [ ! -f ".env.local" ]; then
    echo "⚠️  .env.local not found!"
    echo "   Creating from .env.example..."
    cp .env.example .env.local
    echo ""
    echo "⚠️  Please edit .env.local with your credentials:"
    echo "   - ANYPOINT_CLIENT_ID"
    echo "   - ANYPOINT_CLIENT_SECRET"
    echo "   - SESSION_SECRET (generate with: openssl rand -base64 32)"
    echo ""
    read -p "Press Enter after you've configured .env.local, or Ctrl+C to cancel..."
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Start dev server
echo "🚀 Starting Next.js dev server..."
npm run dev
