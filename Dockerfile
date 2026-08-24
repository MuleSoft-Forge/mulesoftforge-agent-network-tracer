# syntax=docker/dockerfile:1
#
# Single image that runs two process groups on Fly.io:
#   * web    -> Next.js server (npm run start)      — serves UI + /api/lifecycle
#   * worker -> lifecycle-worker.ts (npm run worker) — drains the queue, runs CLI
#
# Both processes share the same code + node_modules; fly.toml picks the command
# per process group.

# --- deps: full dependency tree (incl dev deps for the build + tsx worker) ---
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# `playwright` is a dev-only screenshot tool (help-docs capture); never let its
# postinstall pull ~95MB of Chromium into the image.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci

# --- builder: compile the Next.js app ---
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Build-time only secret to satisfy strict env validation during `next build`.
# Runtime uses real SESSION_SECRET from Fly secrets.
ENV SESSION_SECRET=build-time-session-secret-min-32-chars
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- runner: serves web and runs the worker from one image ---
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ARG ANYPOINT_CLI_VERSION=1.6.14
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    ANYPOINT_CLI_PATH=anypoint-cli-v4 \
    WORKSPACE_ROOT=/tmp/anf-jobs \
    PORT=3000

# Native deps needed by node-gyp when installing CLI plugins (e.g. tree-sitter).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# Anypoint CLI + Agent Fabric plugin — the worker shells out to these for
# build/publish/deploy. Pin the plugin so image builds are reproducible.
RUN npm i -g "anypoint-cli-v4@${ANYPOINT_CLI_VERSION}" \
 && anypoint-cli-v4 plugins:install mulesoft-anypoint-cli-agent-fabric-plugin@1.3.0 \
 && anypoint-cli-v4 --version

# Full dependency tree: `next start` needs next; the worker needs tsx + bullmq +
# ioredis + zod. (Kept whole for correctness; can be slimmed to prod-only later.)
COPY --from=deps /app/node_modules ./node_modules

# Built Next output + static assets.
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

# Runtime config + worker source (the worker runs via tsx from source).
COPY package.json next.config.mjs tsconfig.json ./
COPY lifecycle-worker.ts ./
COPY lib ./lib

EXPOSE 3000

# Default to the web server; the worker process group overrides this in fly.toml.
CMD ["npm", "run", "start"]
