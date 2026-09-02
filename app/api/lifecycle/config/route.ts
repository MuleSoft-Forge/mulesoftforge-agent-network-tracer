import { NextResponse } from "next/server";
import { isLifecycleConfigured } from "@/lib/lifecycle-server/runtime";
import { detectCli, type CliDetection } from "@/lib/lifecycle-server/cli/discover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const DETECT_TIMEOUT_MS = 8_000;

function timedOutCliDetection(): CliDetection {
  return {
    available: false,
    version: null,
    cliPath: "anypoint-cli-v4",
    pluginInstalled: false,
    reason: "detect-failed",
    hint: `CLI detection timed out after ${DETECT_TIMEOUT_MS / 1000}s; runtime may be healthy but probe is stalled.`,
  };
}

/** Tells the client whether the lifecycle feature is available in this deployment. */
export async function GET() {
  const enabled = isLifecycleConfigured();
  if (!enabled) {
    return NextResponse.json({ enabled: false });
  }

  try {
    const cli = await Promise.race([
      detectCli(),
      new Promise<CliDetection>((resolve) => {
        setTimeout(() => {
          resolve(timedOutCliDetection());
        }, DETECT_TIMEOUT_MS);
      }),
    ]);
    return NextResponse.json({ enabled: true, cli });
  } catch {
    return NextResponse.json({
      enabled: true,
      cli: { ...timedOutCliDetection(), hint: "Could not detect Anypoint CLI from the server runtime." },
    });
  }
}
