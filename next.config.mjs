/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === "production";

const nextConfig = {
  reactStrictMode: true,
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
