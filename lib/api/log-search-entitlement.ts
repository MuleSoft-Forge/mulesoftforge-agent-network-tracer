import type { SessionData } from "@/lib/session";

/** Anypoint Monitoring Center Advanced / Titanium (Log Search + traces). */
export const TITANIUM_MONITORING_SKU = 1;

type EntitlementSession = Pick<
  SessionData,
  "monitoringCenterEnabled" | "monitoringProductSKU"
>;

/**
 * Whether the signed-in org should use Anypoint Monitoring Log Search (_msearch).
 *
 * Uses the login probe result only. The probe sets `monitoringCenterEnabled=true`
 * when `_msearch` returns HTTP 200 and either has indexed documents or the org
 * profile reports Titanium (`productSKU` 1). A 404/403 from the probe stays false
 * — do not override with productSKU alone (proxy/host users can get 404 even
 * when the org is Titanium).
 */
export function isLogSearchEntitled(session: EntitlementSession): boolean {
  return session.monitoringCenterEnabled === true;
}

/** Org profile says Titanium/Advanced even when this session cannot reach _msearch. */
export function orgHasTitaniumMonitoring(session: EntitlementSession): boolean {
  return session.monitoringProductSKU === TITANIUM_MONITORING_SKU;
}
