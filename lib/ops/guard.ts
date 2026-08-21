/**
 * Server-side gate for every /api/ops route.
 *
 * The org check is done against the Anypoint profile resolved from the session
 * token, never from anything the browser sends, so hiding the nav item is a
 * convenience and this is the actual boundary.
 */

import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api/auth-middleware";
import { getSession } from "@/lib/session";
import { DEFAULT_BASE_URL } from "@/lib/constants";
import { resolveActorAndOrg } from "@/lib/lifecycle/actor";
import { orgIdsHaveOpsAccess } from "./access";

export interface OpsSession {
  baseUrl: string;
  accessToken: string;
  orgId: string;
  actorLabel: string;
}

export async function requireOps(request: NextRequest): Promise<NextResponse | OpsSession> {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const { baseUrl, accessToken } = authResult;

  let resolved;
  try {
    resolved = await resolveActorAndOrg(baseUrl, accessToken);
  } catch (err) {
    return NextResponse.json(
      { error: "profile_unavailable", message: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }

  const orgIds = [resolved.orgId, ...resolved.businessGroups.map((group) => group.id)];
  if (!orgIdsHaveOpsAccess(orgIds)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  return {
    baseUrl,
    accessToken,
    orgId: resolved.orgId,
    actorLabel: resolved.actor.label ?? resolved.actor.userId,
  };
}

/**
 * Same rule for Server Components, which have a session but no NextRequest.
 * Denies on any failure so a profile hiccup never opens the page up.
 */
export async function sessionHasOpsAccess(): Promise<boolean> {
  try {
    const session = await getSession();
    if (session.invalidatedAt || !session.accessToken) return false;
    const { orgId, businessGroups } = await resolveActorAndOrg(
      session.baseUrl ?? DEFAULT_BASE_URL,
      session.accessToken
    );
    return orgIdsHaveOpsAccess([orgId, ...businessGroups.map((group) => group.id)]);
  } catch {
    return false;
  }
}
