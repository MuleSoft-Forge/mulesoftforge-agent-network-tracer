import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { probeObjectStore } from "@/lib/object-store/client";

export const dynamic = "force-dynamic";

/**
 * **Local development only** (`next dev`). Runs the full Object Store discovery
 * pipeline (store → partitions → key lookup) for a task using the current
 * session token, and returns every intermediate result. Use this to diagnose a
 * "found but no keys" outcome — especially across organizations.
 *
 * Usage:
 *   /api/auth/debug/object-store-probe?orgId=<uuid>&envId=<uuid>&deploymentId=<id>&taskId=<id>&brokerName=<agent-graph-id>
 * Optional: &region=us-east-1 &deploymentType=CH2
 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const session = await getSession();
  if (session.invalidatedAt || !session.accessToken) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  const orgId = params.get("orgId") ?? "";
  const envId = params.get("envId") ?? "";
  const taskId = params.get("taskId") ?? "";
  const deploymentId = params.get("deploymentId");
  const brokerName = params.get("brokerName") ?? "";
  const deploymentType = params.get("deploymentType") ?? undefined;
  const objectStoreRegion = params.get("region") ?? undefined;

  if (!orgId || !envId || !taskId) {
    return NextResponse.json(
      { error: "orgId, envId, and taskId are required. deploymentId and brokerName are strongly recommended." },
      { status: 400 }
    );
  }

  const result = await probeObjectStore({
    orgId,
    envId,
    deploymentId: deploymentId && deploymentId.trim() !== "" ? deploymentId : null,
    brokerName,
    taskId,
    accessToken: session.accessToken,
    deploymentType,
    objectStoreRegion,
  });

  return NextResponse.json({
    warning: "Development only. Do not share output that includes store IDs or keys from another organization.",
    result,
  });
}
