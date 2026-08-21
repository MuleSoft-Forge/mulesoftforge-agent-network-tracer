/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === "production";

const appVersion =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
  process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ??
  process.env.FLY_MACHINE_VERSION ??
  process.env.npm_package_version ??
  "dev";

const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
  // Emit a self-contained server (server.js + minimal node_modules) for
  // container and worker-oriented deployments. Vercel ignores this.
  output: "standalone",
  // Keep the Redis/queue libs as runtime Node externals: they do dynamic
  // requires (Lua scripts, optional deps) that don't survive webpack bundling.
  serverExternalPackages: ["bullmq", "ioredis"],
  // Hide the floating "N" dev indicator (only affects development)
  devIndicators: false,
  // Strip console.* from production client + server bundles (Vercel deploys).
  compiler: isProd ? { removeConsole: true } : undefined,
  transpilePackages: [
    "@sf-agentscript/monaco",
    "@sf-agentscript/language",
    "@sf-agentscript/agentfabric-dialect",
    "@sf-agentscript/agentforce",
    "@sf-agentscript/parser",
    "@sf-agentscript/parser-javascript",
    "@sf-agentscript/agentscript-dialect",
    "@sf-agentscript/agentforce-dialect",
    "@sf-agentscript/compiler",
  ],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    return config;
  },
};

export default nextConfig;
