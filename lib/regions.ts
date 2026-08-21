/**
 * Anypoint control plane regions. MAF supports US and EU; Canada and Japan coming soon.
 * @see https://docs.mulesoft.com/anypoint-code-builder/af-agent-networks#agent-network-architecture
 */
export const CONTROL_PLANE_DOCS_URL =
  "https://docs.mulesoft.com/anypoint-code-builder/af-agent-networks#agent-network-architecture";

export type RegionId = "us" | "eu" | "ca" | "jp";

export interface RegionOption {
  id: RegionId;
  label: string;
  baseUrl: string;
  available: boolean;
}

export const REGIONS: RegionOption[] = [
  {
    id: "us",
    label: "US (Global)",
    baseUrl: "https://anypoint.mulesoft.com",
    available: true,
  },
  {
    id: "eu",
    label: "EU",
    baseUrl: "https://eu1.anypoint.mulesoft.com",
    available: true,
  },
  {
    id: "ca",
    label: "Canada",
    baseUrl: "https://ca1.platform.mulesoft.com",
    available: false,
  },
  {
    id: "jp",
    label: "Japan",
    baseUrl: "https://jp1.platform.mulesoft.com",
    available: false,
  },
];

export function getRegionById(id: RegionId): RegionOption | undefined {
  return REGIONS.find((r: RegionOption) => r.id === id);
}

export function getAvailableRegions(): RegionOption[] {
  return REGIONS.filter((r: RegionOption) => r.available);
}

/** Server-only: region ids that have OAuth client credentials in env. */
export function getConfiguredRegionIds(): RegionId[] {
  return REGIONS.filter((r) => r.available && getCredentialsForRegion(r.id) !== null).map((r) => r.id);
}

/** Regions offered on the sign-in screen. */
export function getSignInRegionIds(): RegionId[] {
  return getConfiguredRegionIds();
}

/** Resolve control-plane base URL for a region (password login, no OAuth creds). */
export function getBaseUrlForRegion(regionId: RegionId): string | null {
  const option = getRegionById(regionId);
  return option?.available ? option.baseUrl : null;
}

/** Server-only: first control plane with credentials, else us (desktop: first available). */
export function getDefaultRegionId(): RegionId {
  const signIn = getSignInRegionIds();
  return signIn[0] ?? "us";
}

/** Server-only: get client id/secret for a region from env. Use in API routes. */
export function getCredentialsForRegion(regionId: RegionId): {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
} | null {
  const option = getRegionById(regionId);
  if (!option?.available) return null;
  const envKey = {
    us: { id: process.env.ANYPOINT_CLIENT_ID, secret: process.env.ANYPOINT_CLIENT_SECRET },
    eu: { id: process.env.ANYPOINT_EU_CLIENT_ID, secret: process.env.ANYPOINT_EU_CLIENT_SECRET },
    ca: { id: process.env.ANYPOINT_CA_CLIENT_ID, secret: process.env.ANYPOINT_CA_CLIENT_SECRET },
    jp: { id: process.env.ANYPOINT_JP_CLIENT_ID, secret: process.env.ANYPOINT_JP_CLIENT_SECRET },
  }[regionId];
  if (!envKey?.id || !envKey?.secret) return null;
  return {
    clientId: envKey.id,
    clientSecret: envKey.secret,
    baseUrl: option.baseUrl,
  };
}

/**
 * Server-only: look up client id/secret by the session's baseUrl. Needed for
 * refresh-token calls, where we don't retain the region id but do store the
 * baseUrl in the iron-session cookie.
 */
export function getCredentialsForBaseUrl(baseUrl: string): {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
} | null {
  const match = REGIONS.find((r) => r.baseUrl === baseUrl);
  if (!match) return null;
  return getCredentialsForRegion(match.id);
}
