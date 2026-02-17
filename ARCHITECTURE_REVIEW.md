# Architecture Review: Next.js 15 + React 19 Code Analysis

**Date:** February 17, 2026  
**Reviewer:** Senior Principal Engineer  
**Focus Areas:** Server-Client Boundary, React 19 Patterns, Zod Validation, Cytoscape Cleanup, Session Race Conditions

---

## Executive Summary

This review identifies **critical architectural friction points** in your Next.js 15 application, particularly around session management race conditions, missing Zod validation, and React 19 pattern adoption. While the codebase demonstrates solid structure, several areas require immediate attention to ensure production-grade reliability.

**Severity Legend:**
- 🔴 **CRITICAL** - Security/Data integrity risk
- 🟠 **HIGH** - Performance/reliability risk  
- 🟡 **MEDIUM** - Code quality/maintainability issue
- 🟢 **LOW** - Optimization opportunity

---

## 1. Data Hydration & Server-Client Boundary

### ✅ **GOOD NEWS: No Cytoscape Serialization Issues**

**Finding:** Cytoscape.js is installed but **not used**. `AgentNetworkCanvas.tsx` uses native SVG rendering, which is fully serializable. No hydration risks detected.

**Recommendation:** Consider removing unused dependencies:
```bash
npm uninstall cytoscape cytoscape-cose-bilkent react-cytoscapejs
```

### 🟡 **Server Component Pattern Underutilization**

**Finding:** All components are marked `"use client"`, meaning you're not leveraging React Server Components (RSC) benefits.

**Impact:** 
- Larger JavaScript bundles
- Missing SEO opportunities
- No server-side data fetching optimization

**Example:** `app/page.tsx` is a Server Component but immediately renders client components. Consider:
```tsx
// Current: All client-side
<ControlPlaneSignIn /> // Client component

// Better: Server Component with client islands
<ControlPlaneSignInWrapper /> // Server Component that fetches initial state
```

**Recommendation:** Gradually migrate static/initial-render components to Server Components.

---

## 2. React 19 Patterns & Concurrent Features

### 🟠 **Missing React 19 `use()` Hook Adoption**

**Finding:** No usage of React 19's `use()` hook for data fetching. All data fetching uses traditional `useEffect` + `fetch` patterns.

**Current Pattern (MainContent.tsx:83-143):**
```tsx
useEffect(() => {
  fetch(`/api/brokers-in-environment?${params}`)
    .then(res => res.json())
    .then(data => setBrokers(data.brokers))
}, [orgId, envId]);
```

**React 19 Pattern (Recommended):**
```tsx
// Create a promise-based resource
const brokersResource = useMemo(() => {
  if (!orgId || !envId) return null;
  return fetch(`/api/brokers-in-environment?orgId=${orgId}&environmentId=${envId}`)
    .then(res => res.json());
}, [orgId, envId]);

// Use React 19's use() hook
const brokersData = brokersResource ? use(brokersResource) : null;
```

**Benefits:**
- Automatic Suspense integration
- Better error boundaries
- Reduced boilerplate
- Concurrent rendering optimization

**Migration Path:**
1. Wrap API routes in Promise-returning functions
2. Replace `useEffect` + `useState` with `use()` + Suspense
3. Add error boundaries for graceful degradation

### 🟡 **useEffect Cleanup in React 19 Concurrent Mode**

**Finding:** Cancellation patterns are correct, but could be improved for React 19's faster re-renders.

**Current (MainContent.tsx:140-142):**
```tsx
return () => {
  cancelled = true;
};
```

**React 19 Enhancement:**
```tsx
useEffect(() => {
  const abortController = new AbortController();
  const signal = abortController.signal;
  
  fetch(url, { signal })
    .then(/* ... */)
    .catch(err => {
      if (err.name !== 'AbortError') {
        // Handle real errors
      }
    });
  
  return () => {
    abortController.abort(); // Native cancellation
  };
}, [deps]);
```

**Recommendation:** Migrate to `AbortController` for better cancellation semantics.

---

## 3. Zod Validation & Type Safety

### 🔴 **CRITICAL: Zod Installed But Not Used**

**Finding:** Zod is installed (`package.json:23`) but **zero usage** in the codebase. All validation is manual with `if` statements.

**Security Risk:** API routes accept unvalidated JSON, risking:
- Type confusion attacks
- Prototype pollution
- SQL injection (if DB layer added)
- XSS via malformed data

**Current Pattern (app/api/broker-tasks/route.ts:766):**
```tsx
const { orgId, apiInstanceId, timeRangeMs } = await request.json();

if (!orgId) {
  return NextResponse.json({ error: "orgId is required" }, { status: 400 });
}
// No type checking, no sanitization
```

**Recommended Pattern:**
```tsx
import { z } from 'zod';

const BrokerTasksRequestSchema = z.object({
  orgId: z.string().min(1).max(100),
  apiInstanceId: z.string().min(1).max(200),
  timeRangeMs: z.number().int().positive().max(7 * 24 * 3600 * 1000).optional(),
});

export async function POST(request: NextRequest) {
  const body = await request.json();
  
  // Server-side validation (security boundary)
  const parseResult = BrokerTasksRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parseResult.error.format() },
      { status: 400 }
    );
  }
  
  const { orgId, apiInstanceId, timeRangeMs } = parseResult.data;
  // Type-safe from here
}
```

**Client-Side Validation (UX):**
```tsx
// components/MainContent.tsx
const handleBrokerTasksFetch = async () => {
  const payload = { orgId, apiInstanceId, timeRangeMs };
  
  // Client-side validation for immediate feedback
  const clientResult = BrokerTasksRequestSchema.safeParse(payload);
  if (!clientResult.success) {
    setError(clientResult.error.errors[0].message);
    return;
  }
  
  // Proceed with fetch
};
```

**Action Items:**
1. Create Zod schemas for all API request/response types
2. Apply validation in all route handlers (`/app/api/**/route.ts`)
3. Add client-side validation for UX
4. Export TypeScript types from schemas: `type BrokerTasksRequest = z.infer<typeof BrokerTasksRequestSchema>`

**Files Requiring Immediate Attention:**
- `app/api/broker-tasks/route.ts` (lines 766-785)
- `app/api/auth/token/route.ts` (line 11)
- `app/api/auth/state/route.ts` (line 16)
- `app/api/task-callstack/route.ts` (multiple endpoints)
- All other API routes

---

## 4. Session Management Race Conditions

### 🔴 **CRITICAL: Dual Session Implementation**

**Finding:** Two separate session files with **different interfaces**:

1. `lib/session.ts` - Returns `{ authenticated: boolean, expiresAt?: number }`
2. `lib/auth/session.ts` - Returns `IronSession<SessionData>`

**Impact:** Inconsistent session access patterns, potential for bugs.

**Current Usage:**
- `lib/session.ts` used in: `app/page.tsx`, `app/api/auth/session/route.ts`
- `lib/auth/session.ts` used in: `lib/auth/oauth.ts` (likely)

**Recommendation:** Consolidate to single source of truth:
```tsx
// lib/session.ts (unified)
export interface SessionData {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  baseUrl?: string;
  oauthState?: string;
  invalidatedAt?: number;
}

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  return await getIronSession<SessionData>(cookieStore, sessionOptions);
}

export async function isAuthenticated(): Promise<boolean> {
  const session = await getSession();
  return !!(session.accessToken && session.expiresAt && session.expiresAt > Date.now());
}
```

### 🔴 **CRITICAL: Race Condition in OAuth State Management**

**Finding:** `app/api/auth/state/route.ts` has a **read-then-clear** race condition:

```tsx
// GET handler (lines 40-54)
export async function GET(request: NextRequest) {
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  const state = session.oauthState; // READ
  
  const response = NextResponse.json({ state: state ?? null });
  
  // Clear AFTER response (race condition!)
  if (state) {
    session.oauthState = undefined;
    await session.save(); // This happens AFTER response is sent
  }
  
  return response;
}
```

**Race Condition Scenario:**
1. Request A calls `GET /api/auth/state` → reads state
2. Request B calls `GET /api/auth/state` → reads same state (before A clears it)
3. Both requests get the same OAuth state
4. CSRF protection bypassed

**Fix (Atomic Read-Clear):**
```tsx
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  const state = session.oauthState;
  
  // Clear BEFORE reading (atomic operation)
  if (state) {
    session.oauthState = undefined;
    await session.save(); // Save synchronously before response
  }
  
  // Now return response
  return NextResponse.json({ state: state ?? null });
}
```

**Better Fix (Use POST for state consumption):**
```tsx
// State should be consumed, not read
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  const { state: providedState } = await request.json();
  
  const storedState = session.oauthState;
  
  // Validate and clear atomically
  if (!storedState || storedState !== providedState) {
    return NextResponse.json({ error: "Invalid state" }, { status: 400 });
  }
  
  session.oauthState = undefined;
  await session.save();
  
  return NextResponse.json({ valid: true });
}
```

### 🟠 **Double Cookie Setting in Token Route**

**Finding:** `app/api/auth/token/route.ts` sets cookies **twice** (lines 76-90):

```tsx
// Setting on response
response.cookies.set("ant_session", sealed, { /* ... */ });

// Also setting on cookieStore (redundant)
cookieStore.set("ant_session", sealed, { /* ... */ });
```

**Issue:** In Next.js 15, `cookies()` returns a read-only store in route handlers. Setting on `cookieStore` may not work as expected.

**Fix:**
```tsx
// Only set on response
const response = NextResponse.json({ success: true });
response.cookies.set("ant_session", sealed, {
  httpOnly: cookieOptions.httpOnly ?? true,
  secure: secure,
  sameSite: sameSite,
  maxAge: cookieOptions.maxAge ?? 90 * 24 * 60 * 60,
  path: "/",
});

// Delete region cookie on response
response.cookies.delete("anypoint_signin_region");

return response;
```

### 🟡 **Middleware Cookie Check vs Route Handler Mismatch**

**Finding:** Middleware uses **synchronous** cookie check, but route handlers use **async** `cookies()`:

```tsx
// middleware.ts (synchronous)
export function hasSessionCookie(request: NextRequest): boolean {
  const cookie = request.cookies.get(SESSION_COOKIE_NAME);
  return !!cookie && cookie.value.length > 0;
}

// Route handlers (async)
const cookieStore = await cookies();
const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
```

**Impact:** Middleware may allow requests that route handlers reject (if cookie exists but session is invalidated).

**Recommendation:** Keep middleware lightweight (cookie existence check is fine), but ensure route handlers always validate session validity.

---

## 5. Cytoscape Cleanup (N/A - Not Used)

**Status:** ✅ Cytoscape.js is not used in the codebase. No cleanup concerns.

**Note:** If you plan to use Cytoscape.js in the future, ensure:
```tsx
useEffect(() => {
  const cy = cytoscape({ /* ... */ });
  
  return () => {
    cy.destroy(); // Critical for memory management
  };
}, [deps]);
```

---

## 6. Next.js 15 Async APIs Usage

### ✅ **Correct Usage of `cookies()`**

**Finding:** All `cookies()` calls are properly awaited:
- `app/api/auth/token/route.ts:20` ✅
- `app/api/auth/session/route.ts:8` ✅
- `lib/session.ts:27` ✅

### 🟡 **Missing `headers()` Usage**

**Finding:** No usage of Next.js 15's async `headers()` API. If you need to read headers in Server Components, use:

```tsx
import { headers } from 'next/headers';

export default async function ServerComponent() {
  const headersList = await headers();
  const userAgent = headersList.get('user-agent');
  // ...
}
```

**Current:** No Server Components read headers, so this is acceptable.

---

## 7. Type Safety & Type Leaks

### 🟠 **Unsafe JSON Parsing**

**Finding:** Multiple instances of unsafe `JSON.parse()` without validation:

**Examples:**
- `components/Header.tsx:27`: `JSON.parse(raw) as Profile`
- `components/BusinessGroupSelector.tsx:31`: `JSON.parse(raw) as Profile`
- `components/task-details/TaskDetailsPanel.tsx:14`: `JSON.parse(value)`

**Risk:** Runtime errors, type confusion, potential XSS if parsing user input.

**Fix:**
```tsx
import { z } from 'zod';

const ProfileSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  username: z.string(),
  email: z.string().email().optional(),
  organization: z.object({
    name: z.string(),
  }).optional(),
});

function parseProfile(raw: string): Profile | null {
  try {
    const parsed = JSON.parse(raw);
    const result = ProfileSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
```

---

## 8. Recommended Refactors (ES2026 Syntax)

### Example 1: Session Management with Modern Patterns

```tsx
// lib/session.ts (refactored)
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { z } from "zod";

const SessionDataSchema = z.object({
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
  baseUrl: z.string().url().optional(),
  oauthState: z.string().optional(),
  invalidatedAt: z.number().optional(),
});

export type SessionData = z.infer<typeof SessionDataSchema>;

const sessionOptions = {
  password: process.env.SESSION_SECRET || "change-me-to-a-random-secret-key-min-32-chars",
  cookieName: "ant_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax" as const,
    maxAge: 90 * 24 * 60 * 60,
  },
} as const;

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  
  // Validate session data structure
  const validated = SessionDataSchema.safeParse(session);
  if (!validated.success) {
    // Reset corrupted session
    session.destroy();
    return await getIronSession<SessionData>(cookieStore, sessionOptions);
  }
  
  return session;
}

export async function isAuthenticated(): Promise<boolean> {
  const session = await getSession();
  const { accessToken, expiresAt, invalidatedAt } = session;
  
  if (invalidatedAt) return false;
  if (!accessToken || !expiresAt) return false;
  return expiresAt > Date.now();
}
```

### Example 2: API Route with Zod Validation

```tsx
// app/api/broker-tasks/route.ts (refactored)
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { isAuthenticated } from "@/lib/session";

const BrokerTasksRequestSchema = z.object({
  orgId: z.string().min(1).max(100),
  apiInstanceId: z.string().min(1).max(200),
  timeRangeMs: z.number().int().positive().max(7 * 24 * 3600 * 1000).optional(),
});

export async function POST(request: NextRequest) {
  // Authentication check
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  
  const session = await getSession();
  if (session.invalidatedAt) {
    return NextResponse.json({ error: "Session invalidated" }, { status: 401 });
  }
  
  // Parse and validate request body
  const body = await request.json();
  const parseResult = BrokerTasksRequestSchema.safeParse(body);
  
  if (!parseResult.success) {
    return NextResponse.json(
      { 
        error: "Invalid request", 
        details: parseResult.error.format() 
      },
      { status: 400 }
    );
  }
  
  const { orgId, apiInstanceId, timeRangeMs = 24 * 3600 * 1000 } = parseResult.data;
  const baseUrl = session.baseUrl ?? DEFAULT_BASE_URL;
  
  // Proceed with validated, type-safe data
  // ...
}
```

### Example 3: React 19 use() Hook Pattern

```tsx
// components/MainContent.tsx (refactored)
import { use, useMemo, Suspense } from "react";

function BrokersList({ orgId, envId }: { orgId: string; envId: string }) {
  const brokersResource = useMemo(() => {
    if (!orgId || !envId) return null;
    
    return fetch(`/api/brokers-in-environment?orgId=${orgId}&environmentId=${envId}`)
      .then(async (res) => {
        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.error || `Failed: ${res.status}`);
        }
        return res.json();
      });
  }, [orgId, envId]);
  
  if (!brokersResource) {
    return <div>Select organization and environment</div>;
  }
  
  const data = use(brokersResource);
  const brokers = data.brokers ?? [];
  
  return (
    <div>
      {brokers.map(broker => (
        <div key={broker.nodeId}>{broker.name}</div>
      ))}
    </div>
  );
}

export default function MainContent() {
  const [orgId, setOrgId] = useState("");
  const [envId, setEnvId] = useState("");
  
  return (
    <Suspense fallback={<div>Loading brokers...</div>}>
      <BrokersList orgId={orgId} envId={envId} />
    </Suspense>
  );
}
```

---

## 9. Action Items Priority

### Immediate (This Sprint)
1. 🔴 **Add Zod validation to all API routes**
2. 🔴 **Fix OAuth state race condition** (`app/api/auth/state/route.ts`)
3. 🔴 **Consolidate session implementations** (merge `lib/session.ts` and `lib/auth/session.ts`)
4. 🔴 **Remove double cookie setting** (`app/api/auth/token/route.ts`)

### Short-term (Next Sprint)
5. 🟠 **Migrate to React 19 `use()` hook** for data fetching
6. 🟠 **Add Zod schemas for all JSON.parse() calls**
7. 🟡 **Remove unused Cytoscape dependencies**

### Medium-term (Next Month)
8. 🟡 **Migrate static components to Server Components**
9. 🟡 **Add comprehensive error boundaries**
10. 🟢 **Optimize bundle size** (code splitting, tree shaking)

---

## 10. Testing Recommendations

### Session Race Condition Tests
```tsx
// __tests__/api/auth/state.test.ts
describe('OAuth State Management', () => {
  it('should prevent race condition in state consumption', async () => {
    // Set initial state
    await fetch('/api/auth/state', {
      method: 'POST',
      body: JSON.stringify({ state: 'test-state-123' }),
    });
    
    // Simulate concurrent requests
    const [req1, req2] = await Promise.all([
      fetch('/api/auth/state'),
      fetch('/api/auth/state'),
    ]);
    
    const [data1, data2] = await Promise.all([
      req1.json(),
      req2.json(),
    ]);
    
    // Only one should get the state
    expect(data1.state === 'test-state-123' || data2.state === 'test-state-123').toBe(true);
    expect(data1.state === data2.state).toBe(false);
  });
});
```

### Zod Validation Tests
```tsx
// __tests__/api/broker-tasks/validation.test.ts
describe('Broker Tasks API Validation', () => {
  it('should reject invalid orgId', async () => {
    const res = await fetch('/api/broker-tasks', {
      method: 'POST',
      body: JSON.stringify({ orgId: '', apiInstanceId: '123' }),
    });
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid request');
  });
  
  it('should enforce timeRangeMs maximum', async () => {
    const res = await fetch('/api/broker-tasks', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-123',
        apiInstanceId: 'api-123',
        timeRangeMs: 8 * 24 * 3600 * 1000, // 8 days (exceeds max)
      }),
    });
    
    expect(res.status).toBe(400);
  });
});
```

---

## Conclusion

Your codebase demonstrates solid architectural patterns, but **critical security and reliability gaps** exist around validation and session management. The most urgent fixes are:

1. **Zod validation** (security risk)
2. **OAuth state race condition** (security risk)
3. **Session consolidation** (maintainability risk)

After addressing these, focus on React 19 migration for better performance and developer experience.

**Estimated Effort:**
- Critical fixes: 2-3 days
- React 19 migration: 1-2 weeks
- Full Zod adoption: 1 week

---

*Review completed: February 17, 2026*
