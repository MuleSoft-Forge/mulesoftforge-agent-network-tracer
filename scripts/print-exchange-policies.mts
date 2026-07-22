/**
 * Print Exchange policy catalog (getExchangePolicyTemplates) for debugging.
 *
 * Usage (while signed in to Anypoint, copy bearer token from DevTools):
 *   export ANYPOINT_AUDIT_TOKEN='...'
 *   export ORG_ID='eca25329-9592-4ff1-9054-1b08d103b991'   # optional
 *   npx tsx scripts/print-exchange-policies.mts
 *
 * Or hit the app route in a signed-in browser:
 *   /api/exchange/policies?organizationId=YOUR_ORG_ID
 */

import { fetchExchangePolicyCatalog } from "@/lib/mulesoft/exchange-policy-templates";

const baseUrl = process.env.ANYPOINT_BASE_URL ?? "https://anypoint.mulesoft.com";
const token = process.env.ANYPOINT_AUDIT_TOKEN ?? process.env.ANYPOINT_ACCESS_TOKEN;
const organizationId = process.env.ORG_ID ?? process.argv[2];

if (!token) {
  console.error("Set ANYPOINT_AUDIT_TOKEN (bearer token from a signed-in Anypoint session).");
  process.exit(1);
}
if (!organizationId) {
  console.error("Set ORG_ID or pass organizationId as first argument.");
  process.exit(1);
}

const catalog = await fetchExchangePolicyCatalog(baseUrl, token, { organizationId });

function summarize(direction: "inbound" | "outbound") {
  const rows = catalog[direction];
  const mulesoft = rows.filter((r) => r.provider === "mulesoft").length;
  const org = rows.filter((r) => r.provider === "organization").length;
  console.log(`\n=== ${direction.toUpperCase()} (${rows.length} total: ${mulesoft} MuleSoft, ${org} org) ===`);
  for (const p of rows) {
    const tag = p.provider === "mulesoft" ? "MuleSoft" : "Org     ";
    const cat = p.category ? ` · ${p.category}` : "";
    const ver = p.version ? ` @ ${p.version}` : "";
    console.log(`  [${tag}] ${p.name}${cat}${ver}`);
    console.log(`           ${p.groupId}/${p.assetId}`);
  }
}

console.log(`Organization: ${organizationId}`);
console.log(`Source: getExchangePolicyTemplates`);
console.log(`Total: ${catalog.inbound.length + catalog.outbound.length}`);

summarize("inbound");
summarize("outbound");

console.log("\n=== Full JSON ===");
console.log(
  JSON.stringify(
    {
      inbound: catalog.inbound,
      outbound: catalog.outbound,
      total: catalog.inbound.length + catalog.outbound.length,
      source: "getExchangePolicyTemplates",
    },
    null,
    2
  )
);
