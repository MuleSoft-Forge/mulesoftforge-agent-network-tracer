# Code Refactoring Recommendations

## Executive Summary

This document identifies duplicate code patterns across the codebase that can be refactored to improve maintainability and performance. The analysis found **6 major duplication patterns** affecting **15+ files**.

---

## 1. API Route Authentication Middleware ⚠️ HIGH PRIORITY

### Problem
Authentication checks are duplicated across **10+ API route handlers** with identical patterns:

```typescript
// Repeated in: broker-tasks, task-callstack, brokers-in-environment, 
// exchange/asset, exchange/metadata, exchange/icon, visualizer, 
// auth/profile, accounts/organizations

if (!(await isAuthenticated())) {
  return NextResponse.json({ error: "Not signed in" }, { status: 401 });
}

const session = await getSession();

if (session.invalidatedAt || !session.accessToken) {
  return NextResponse.json({ error: "Not signed in" }, { status: 401 });
}

const baseUrl = session.baseUrl ?? DEFAULT_BASE_URL;
```

### Impact
- **Maintainability**: Changes to auth logic require updates in 10+ files
- **Consistency**: Risk of inconsistent error messages
- **Performance**: Redundant session lookups

### Solution
Create a reusable authentication middleware function:

**Create `lib/api/auth-middleware.ts`:**
```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSession, isAuthenticated } from "@/lib/session";

const DEFAULT_BASE_URL = "https://anypoint.mulesoft.com";

export interface AuthenticatedSession {
  session: Awaited<ReturnType<typeof getSession>>;
  baseUrl: string;
  accessToken: string;
}

/**
 * Middleware to authenticate API routes
 * Returns authenticated session or error response
 */
export async function requireAuth(
  request: NextRequest
): Promise<NextResponse | AuthenticatedSession> {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const session = await getSession();

  if (session.invalidatedAt || !session.accessToken) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  return {
    session,
    baseUrl: session.baseUrl ?? DEFAULT_BASE_URL,
    accessToken: session.accessToken,
  };
}
```

**Usage Example:**
```typescript
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  
  const { session, baseUrl, accessToken } = authResult;
  // Use authenticated session...
}
```

### Files Affected
- `app/api/broker-tasks/route.ts`
- `app/api/task-callstack/route.ts`
- `app/api/brokers-in-environment/route.ts`
- `app/api/exchange/asset/route.ts`
- `app/api/exchange/metadata/route.ts`
- `app/api/exchange/icon/route.ts`
- `app/api/visualizer/[...path]/route.ts`
- `app/api/auth/profile/route.ts`
- `app/api/accounts/organizations/[orgId]/environments/route.ts`

---

## 2. DEFAULT_BASE_URL Constant ⚠️ MEDIUM PRIORITY

### Problem
`DEFAULT_BASE_URL` is defined in **10+ files**:

```typescript
const DEFAULT_BASE_URL = "https://anypoint.mulesoft.com";
```

### Impact
- **Maintainability**: Changing the default requires updates in multiple files
- **Consistency**: Risk of inconsistent values

### Solution
**Create `lib/constants.ts`:**
```typescript
export const DEFAULT_BASE_URL = "https://anypoint.mulesoft.com";
export const DEFAULT_ACTIVITY_PERIOD_MINUTES = 1440; // 24h
```

**Update all files to import from constants:**
```typescript
import { DEFAULT_BASE_URL } from "@/lib/constants";
```

### Files Affected
- `app/api/broker-tasks/route.ts`
- `app/api/task-callstack/route.ts`
- `app/api/brokers-in-environment/route.ts`
- `app/api/exchange/asset/route.ts`
- `app/api/exchange/metadata/route.ts`
- `app/api/exchange/icon/route.ts`
- `app/api/visualizer/[...path]/route.ts`
- `app/api/auth/profile/route.ts`
- `app/api/accounts/organizations/[orgId]/environments/route.ts`
- `lib/auth/config.ts` (already has it, but should use shared constant)

---

## 3. msearch Function Duplication ⚠️ HIGH PRIORITY

### Problem
The `msearch` function is **duplicated** in two files with nearly identical implementations:

- `app/api/broker-tasks/route.ts` (lines 10-75)
- `app/api/task-callstack/route.ts` (lines 144-205)

### Impact
- **Maintainability**: Bug fixes must be applied twice
- **Consistency**: Risk of divergent implementations
- **Code Size**: ~65 lines duplicated

### Solution
**Create `lib/api/msearch.ts`:**
```typescript
import { loggedFetch } from "@/lib/api-logger";

export interface MSearchOptions {
  size?: number;
  sortOrder?: "asc" | "desc";
  timeRangeMs?: number;
}

export interface MSearchResult {
  total: number;
  hits: unknown[];
  raw: unknown;
  error?: "MONITORING_CENTER_PREMIUM_REQUIRED";
}

/**
 * Execute Elasticsearch _msearch query via Anypoint Monitoring API
 */
export async function msearch(
  orgId: string,
  luceneQuery: string,
  opts: MSearchOptions = {},
  accessToken: string,
  baseUrl: string
): Promise<MSearchResult> {
  const { size = 500, sortOrder = "asc", timeRangeMs = 30 * 24 * 3600 * 1000 } = opts;
  const now = Date.now();
  
  const ndjson = [
    JSON.stringify({ index: [], ignore_unavailable: true, preference: now }),
    JSON.stringify({
      version: true,
      size,
      sort: [{ timestamp: { order: sortOrder, unmapped_type: "boolean" } }],
      _source: { excludes: [] },
      stored_fields: ["*"],
      docvalue_fields: ["timestamp"],
    }),
    JSON.stringify({
      filter: [
        {
          range: {
            timestamp: {
              gte: now - timeRangeMs,
              lte: now,
              format: "epoch_millis",
            },
          },
        },
      ],
      query: [{ query: luceneQuery, language: "lucene" }],
    }),
  ].join("\n") + "\n";

  const url = `${baseUrl}/monitoring/api/logs/elasticsearch/_msearch`;
  const res = await loggedFetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-ndjson",
    },
    body: ndjson,
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 403 && text.includes("Monitoring Center Premium")) {
      return { total: 0, hits: [], raw: {}, error: "MONITORING_CENTER_PREMIUM_REQUIRED" };
    }
    throw new Error(`_msearch ${res.status}: ${text.slice(0, 200)}`);
  }

  const raw = await res.json();
  const r = (raw.responses || [])[0] || {};
  const hits = (r.hits && r.hits.hits) || [];
  return { total: r.hits ? r.hits.total : 0, hits, raw };
}
```

**Update both files to import:**
```typescript
import { msearch } from "@/lib/api/msearch";
```

### Files Affected
- `app/api/broker-tasks/route.ts`
- `app/api/task-callstack/route.ts`

---

## 4. Exchange API Route Parameter Parsing ⚠️ MEDIUM PRIORITY

### Problem
`exchange/asset/route.ts` and `exchange/metadata/route.ts` have **nearly identical** query parameter parsing logic (lines 28-80 in asset, lines 64-116 in metadata):

```typescript
// Repeated pattern:
const { searchParams } = new URL(request.url);
const organizationIdParam = searchParams.get("organizationId") ?? undefined;
const assetIdParam = searchParams.get("assetId") ?? undefined;
const versionParam = searchParams.get("version") ?? undefined;
const pathParam = searchParams.get("path") ?? undefined;

const parseResult = ExchangeAssetRequestSchema.safeParse({...});

// Extract organizationId, assetId, version from either format
if (parseResult.data.organizationId && parseResult.data.assetId && parseResult.data.version) {
  // Format 1: separate query parameters
  organizationId = parseResult.data.organizationId;
  assetId = parseResult.data.assetId;
  version = parseResult.data.version;
} else if (parseResult.data.path) {
  // Format 2: path format
  const pathParts = parseResult.data.path.split("/");
  // ... validation and extraction
}
```

### Impact
- **Maintainability**: Changes to parameter parsing require updates in 2+ files
- **Consistency**: Risk of divergent behavior

### Solution
**Create `lib/api/exchange-params.ts`:**
```typescript
import { z } from "zod";

const ExchangeParamsSchema = z.object({
  organizationId: z.string().optional(),
  assetId: z.string().optional(),
  version: z.string().optional(),
  path: z.string().optional(),
}).refine(
  (data) => 
    (data.organizationId && data.assetId && data.version) || 
    data.path,
  "Either provide organizationId, assetId, and version, or provide path"
);

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
  schema: z.ZodSchema
): ParsedExchangeParams {
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
    return {
      organizationId: data.organizationId,
      assetId: data.assetId,
      version: data.version,
    };
  }

  if (data.path) {
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
```

**Usage:**
```typescript
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const params = parseExchangeParams(searchParams, ExchangeAssetRequestSchema);
  // Use params.organizationId, params.assetId, params.version
}
```

### Files Affected
- `app/api/exchange/asset/route.ts`
- `app/api/exchange/metadata/route.ts`

---

## 5. Error Response Formatting ⚠️ LOW PRIORITY

### Problem
Similar error response patterns across routes:

```typescript
// Pattern 1: Validation errors
if (!parseResult.success) {
  return NextResponse.json(
    {
      error: "Invalid request",
      details: parseResult.error.format(),
    },
    { status: 400 }
  );
}

// Pattern 2: API errors
if (!res.ok) {
  const text = await res.text();
  return NextResponse.json(
    { error: `API failed: ${res.status} ${text.slice(0, 200)}` },
    { status: res.status }
  );
}
```

### Solution
**Create `lib/api/error-responses.ts`:**
```typescript
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function validationError(error: ZodError) {
  return NextResponse.json(
    {
      error: "Invalid request",
      details: error.format(),
    },
    { status: 400 }
  );
}

export function apiError(message: string, status: number, details?: string) {
  return NextResponse.json(
    {
      error: message,
      ...(details && { details: details.slice(0, 200) }),
    },
    { status }
  );
}
```

### Files Affected
- Multiple API route files (optional improvement)

---

## 6. Runtime Log Parsing Logic ⚠️ MEDIUM PRIORITY

### Problem
Similar log parsing patterns in:
- `app/api/broker-tasks/route.ts` (`parseLogsForTasks` function, lines 465-649)
- `app/api/task-callstack/route.ts` (`parseRuntimeLogsToEntriesAndJobCard` function, lines 431-504)

Both parse runtime logs to extract task information, though with different output formats.

### Solution
**Consider creating `lib/parsers/runtime-logs.ts`** to consolidate common parsing logic, though the functions serve different purposes and may need to remain separate. Review for shared regex patterns and parsing utilities.

---

## Implementation Priority

1. **High Priority** (Immediate Impact):
   - ✅ API Route Authentication Middleware (#1)
   - ✅ msearch Function (#3)

2. **Medium Priority** (Next Sprint):
   - ✅ DEFAULT_BASE_URL Constant (#2)
   - ✅ Exchange API Parameter Parsing (#4)
   - Runtime Log Parsing (#6)

3. **Low Priority** (Future Enhancement):
   - Error Response Formatting (#5)

---

## Performance Benefits

1. **Reduced Bundle Size**: Shared utilities reduce code duplication
2. **Faster Development**: Changes to auth logic only need to be made once
3. **Better Caching**: Shared functions can be optimized and cached more effectively
4. **Type Safety**: Centralized types reduce inconsistencies

---

## Testing Recommendations

After refactoring:

1. **Unit Tests**: Test shared utilities in isolation
2. **Integration Tests**: Verify API routes still work correctly
3. **E2E Tests**: Ensure authentication flow works end-to-end
4. **Performance Tests**: Measure impact on API response times

---

## Migration Strategy

1. **Phase 1**: Create shared utilities (auth middleware, constants, msearch)
2. **Phase 2**: Migrate high-traffic routes first (broker-tasks, task-callstack)
3. **Phase 3**: Migrate remaining routes
4. **Phase 4**: Remove old duplicate code
5. **Phase 5**: Add tests and documentation

---

## Estimated Impact

- **Lines of Code Reduced**: ~500+ lines
- **Files Simplified**: 15+ files
- **Maintainability**: Significantly improved
- **Performance**: Minimal impact (slight improvement from reduced duplication)
- **Risk**: Low (refactoring is straightforward, well-tested patterns)
