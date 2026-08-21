import { z } from "zod";

export interface ParsedExchangeParams {
  organizationId: string;
  assetId: string;
  version: string;
}

/**
 * Parse Exchange API parameters from query string
 * Supports both formats:
 * 1. organizationId, assetId, version (separate params)
 * 2. path (organizationId/assetId/version)
 */
export function parseExchangeParams(
  searchParams: URLSearchParams,
  schema: z.ZodSchema<{
    organizationId?: string;
    assetId?: string;
    version?: string;
    path?: string;
  }>
): ParsedExchangeParams {
  // Convert null to undefined for Zod (searchParams.get returns string | null, but Zod expects string | undefined)
  const organizationIdParam = searchParams.get("organizationId") ?? undefined;
  const assetIdParam = searchParams.get("assetId") ?? undefined;
  const versionParam = searchParams.get("version") ?? undefined;
  const pathParam = searchParams.get("path") ?? undefined;

  const parseResult = schema.safeParse({
    organizationId: organizationIdParam,
    assetId: assetIdParam,
    version: versionParam,
    path: pathParam,
  });

  if (!parseResult.success) {
    throw new Error(`Invalid request: ${JSON.stringify(parseResult.error.format())}`);
  }

  const data = parseResult.data;

  if (data.organizationId && data.assetId && data.version) {
    // Format 1: separate query parameters
    return {
      organizationId: data.organizationId,
      assetId: data.assetId,
      version: data.version,
    };
  }

  if (data.path) {
    // Format 2: path format (organizationId/assetId/version)
    const pathParts = data.path.split("/");
    if (pathParts.length < 3) {
      throw new Error("Invalid path format. Expected: organizationId/assetId/version");
    }
    return {
      organizationId: pathParts[0],
      assetId: pathParts[1],
      version: pathParts[2],
    };
  }

  throw new Error("Either provide organizationId, assetId, and version, or provide path");
}
