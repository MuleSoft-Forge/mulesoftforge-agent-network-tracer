/** One-off: print normalized catalog from mock XAPI payloads (no auth). */
import { fetchExchangePolicyCatalog } from "@/lib/mulesoft/exchange-policy-templates";

const inboundRaw = [
  {
    groupId: "68ef9520-24e9-4cf2-b2f5-620025690913",
    assetId: "rate-limiting",
    assetVersion: "1.4.0",
    name: "Rate Limiting",
    description: "Limits the number of requests an API can receive within a given period of time.",
    type: "system",
    category: "Quality of Service",
  },
  {
    groupId: "68ef9520-24e9-4cf2-b2f5-620025690913",
    assetId: "client-id-enforcement",
    assetVersion: "1.3.0",
    name: "Client ID Enforcement",
    type: "system",
    category: "Security",
  },
  {
    groupId: "68ef9520-24e9-4cf2-b2f5-620025690913",
    assetId: "message-logging",
    assetVersion: "1.0.0",
    name: "Message Logging",
    type: "system",
    category: "Troubleshooting",
  },
  {
    groupId: "eca25329-9592-4ff1-9054-1b08d103b991",
    assetId: "my-org-custom-policy",
    assetVersion: "1.0.0",
    name: "My Org Custom Policy",
    type: "custom",
    category: "Security",
  },
];

const outboundRaw = [
  {
    groupId: "68ef9520-24e9-4cf2-b2f5-620025690913",
    assetId: "credential-injection-oauth2-obo",
    assetVersion: "1.1.1",
    name: "OAuth2 OBO Credential Injection",
    type: "system",
    category: "Security",
  },
  {
    groupId: "68ef9520-24e9-4cf2-b2f5-620025690913",
    assetId: "a2a-pii-detector",
    assetVersion: "1.0.0",
    name: "A2A PII Detector",
    type: "system",
    category: "AI",
  },
];

async function mockFetch(input: string): Promise<Response> {
  const body = String(input).includes("injectionPoint=outbound") ? outboundRaw : inboundRaw;
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const catalog = await fetchExchangePolicyCatalog(
  "https://anypoint.mulesoft.com",
  "mock",
  { organizationId: "eca25329-9592-4ff1-9054-1b08d103b991" },
  mockFetch
);

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
