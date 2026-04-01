import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Public build metadata injected by Vercel at build time. Lets you confirm the
 * running deployment matches Git (compare short SHA to `git log -1`).
 */
export async function GET() {
  return NextResponse.json({
    gitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    gitCommitRef: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    vercelUrl: process.env.VERCEL_URL ?? null,
  });
}
