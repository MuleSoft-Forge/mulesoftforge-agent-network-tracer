/**
 * Resolve the acting user + target org from the Anypoint profile, server-side.
 *
 * Jobs are attributed to a real user and scoped to a real org — the client
 * cannot spoof either, because we derive both from the session's access token.
 */

import "server-only";
import type { JobActor } from "@/lib/lifecycle/types";

export interface ActorAndOrg {
  actor: JobActor;
  /** The session's own (root) org — the default deploy target. */
  orgId: string;
  /** Every business group the user belongs to, for id -> name resolution. */
  businessGroups: BusinessGroup[];
}

/** The CLI takes `--organization` by name, so both are resolved server-side. */
export interface BusinessGroup {
  id: string;
  name: string;
}

interface AnypointOrganization {
  id?: string;
  name?: string;
}

interface AnypointProfile {
  id?: string;
  username?: string;
  email?: string;
  organization?: AnypointOrganization;
  memberOfOrganizations?: AnypointOrganization[];
}

function collectBusinessGroups(profile: AnypointProfile): BusinessGroup[] {
  const byId = new Map<string, string>();
  const add = (org: AnypointOrganization | undefined) => {
    const id = org?.id?.trim();
    const name = org?.name?.trim();
    if (id && name && !byId.has(id)) byId.set(id, name);
  };

  add(profile.organization);
  for (const org of profile.memberOfOrganizations ?? []) add(org);

  return [...byId.entries()].map(([id, name]) => ({ id, name }));
}

export async function resolveActorAndOrg(
  baseUrl: string,
  accessToken: string
): Promise<ActorAndOrg> {
  const res = await fetch(`${baseUrl}/accounts/api/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Could not load Anypoint profile (${res.status}).`);
  }
  const profile = (await res.json()) as AnypointProfile;

  const orgId = profile.organization?.id;
  if (!orgId) {
    throw new Error("Anypoint profile has no organization id.");
  }

  const userId = profile.id ?? profile.username;
  if (!userId) {
    throw new Error("Anypoint profile has no user id.");
  }

  return {
    orgId,
    businessGroups: collectBusinessGroups(profile),
    actor: { userId, label: profile.email ?? profile.username },
  };
}
