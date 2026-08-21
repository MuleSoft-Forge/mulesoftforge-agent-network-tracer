/**
 * Access gate for the Ops area (Fly + queue diagnostics).
 *
 * The allowlist is read from `OPS_ORG_IDS` (comma-separated Anypoint org ids)
 * so no account identifier is baked into source or shipped to the browser.
 * Server-only on purpose: the previous client-side check meant the org id was
 * readable in the public JS bundle by anyone who loaded the app.
 *
 * Fails closed. An unset or empty `OPS_ORG_IDS` grants nobody access rather
 * than everybody.
 */

import "server-only";

function allowedOrgIds(): readonly string[] {
  return (process.env.OPS_ORG_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

/**
 * Membership counts, not just the session's root org: an allowlisted id may be
 * a business group rather than the root, and the gate has to hold either way.
 */
export function orgIdsHaveOpsAccess(orgIds: readonly string[]): boolean {
  const allowed = allowedOrgIds();
  if (allowed.length === 0) return false;
  return orgIds.some((id) => Boolean(id) && allowed.includes(id));
}
