#!/bin/bash

# Reset script - Kills all processes and cleans up state

set -e

echo "🛑 Stopping all processes..."

# Kill Next.js dev server (port 3000)
if lsof -ti:3000 > /dev/null 2>&1; then
    echo "   Killing Next.js dev server on port 3000..."
    lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    sleep 1
fi

# Kill any node processes related to this project
if pgrep -f "next dev" > /dev/null; then
    echo "   Killing Next.js processes..."
    pkill -f "next dev" 2>/dev/null || true
    sleep 1
fi

# Kill any proxy processes (if running on common ports)
for port in 8080 8081 3001 3002; do
    if lsof -ti:$port > /dev/null 2>&1; then
        echo "   Killing process on port $port..."
        lsof -ti:$port | xargs kill -9 2>/dev/null || true
    fi
done

echo "🧹 Cleaning up..."

# Remove Next.js build artifacts
if [ -d ".next" ]; then
    echo "   Removing .next directory..."
    rm -rf .next
fi

# Remove node_modules/.cache if exists
if [ -d "node_modules/.cache" ]; then
    echo "   Clearing node_modules cache..."
    rm -rf node_modules/.cache
fi

# Clear npm cache (optional, commented out by default)
# echo "   Clearing npm cache..."
# npm cache clean --force

echo "✅ Reset complete!"
echo ""
echo "To start fresh, run:"
echo "   npm run dev"
echo ""
echo "Or use: npm run start:clean"
