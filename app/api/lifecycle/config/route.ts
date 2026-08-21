import { NextResponse } from "next/server";
import { isLifecycleConfigured } from "@/lib/lifecycle-server/runtime";
import { detectCli } from "@/lib/lifecycle-server/cli/discover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tells the client whether the lifecycle feature is available in this deployment. */
export async function GET() {
  const enabled = isLifecycleConfigured();
  if (!enabled) {
    return NextResponse.json({ enabled: false });
  }

  try {
    const cli = await detectCli();
    return NextResponse.json({ enabled: true, cli });
  } catch {
    return NextResponse.json({
      enabled: true,
      cli: {
        available: false,
        version: null,
        cliPath: null,
        pluginInstalled: false,
        reason: "detect-failed",
        hint: "Could not detect Anypoint CLI from the server runtime.",
      },
    });
  }
}
