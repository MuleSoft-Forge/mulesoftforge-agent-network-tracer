# Refactor Examples: Implementation Guide

This document provides concrete code examples for implementing the fixes identified in `ARCHITECTURE_REVIEW.md`.

---

## 1. Unified Session Management

### File: `lib/session.ts` (Refactored)

```tsx
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { z } from "zod";

// Zod schema for runtime validation
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
    maxAge: 90 * 24 * 60 * 60, // 90 days
  },
} as const;

/**
 * Get the current session (unified implementation)
 * Validates session data structure and handles corrupted sessions
 */
export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  
  // Validate session data structure (prevent type confusion attacks)
  const validated = SessionDataSchema.safeParse(session);
  if (!validated.success) {
    // Session data is corrupted, reset it
    session.destroy();
    return await getIronSession<SessionData>(cookieStore, sessionOptions);
  }
  
  return session;
}

/**
 * Check if user is authenticated
 * Handles invalidated sessions and expired tokens
 */
export async function isAuthenticated(): Promise<boolean> {
  try {
    const session = await getSession();
    const { accessToken, expiresAt, invalidatedAt } = session;
    
    // Check invalidation first (corporate governance)
    if (invalidatedAt) return false;
    
    // Check token existence and expiration
    if (!accessToken || !expiresAt) return false;
    
    // Add 5-minute buffer for token refresh
    return expiresAt > Date.now() + 5 * 60 * 1000;
  } catch {
    return false;
  }
}

/**
 * Get session status (for Server Components)
 * Returns minimal data suitable for serialization
 */
export async function getSessionStatus() {
  try {
    const session = await getSession();
    
    if (session.invalidatedAt) {
      return { authenticated: false };
    }
    
    const isAuth = !!(session.accessToken && session.expiresAt && session.expiresAt > Date.now());
    
    return {
      authenticated: isAuth,
      expiresAt: session.expiresAt,
      baseUrl: session.baseUrl,
    };
  } catch {
    return { authenticated: false };
  }
}

export { sessionOptions };
```

---

## 2. Fixed OAuth State Management

### File: `app/api/auth/state/route.ts` (Refactored)

```tsx
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { z } from "zod";

const StateRequestSchema = z.object({
  state: z.string().min(1).max(200),
  region: z.string().optional(),
});

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 600, // 10 minutes
  path: "/",
} as const;

/**
 * Store OAuth state (POST - idempotent)
 * Called before redirecting to OAuth provider
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parseResult = StateRequestSchema.safeParse(body);
    
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parseResult.error.format() },
        { status: 400 }
      );
    }
    
    const { state, region } = parseResult.data;
    
    // Store state in session (atomic write)
    const session = await getSession();
    session.oauthState = state;
    await session.save();
    
    const response = NextResponse.json({ success: true });
    
    // Store region in separate cookie for token exchange
    if (region) {
      response.cookies.set("anypoint_signin_region", region, COOKIE_OPTIONS);
    }
    
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Consume OAuth state (POST - atomic read-and-clear)
 * Validates provided state against stored state and clears it
 * 
 * CRITICAL: This prevents race conditions by atomically consuming the state
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    const storedState = session.oauthState;
    
    // Atomic read-and-clear (prevents race conditions)
    if (storedState) {
      session.oauthState = undefined;
      await session.save(); // Save BEFORE returning response
    }
    
    return NextResponse.json({ state: storedState ?? null });
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Validate OAuth state (POST - for callback validation)
 * Alternative approach: validate and consume in one atomic operation
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { state: providedState } = z.object({
      state: z.string(),
    }).parse(body);
    
    const session = await getSession();
    const storedState = session.oauthState;
    
    // Validate and clear atomically
    if (!storedState || storedState !== providedState) {
      return NextResponse.json(
        { error: "Invalid state", valid: false },
        { status: 400 }
      );
    }
    
    // Clear state after successful validation
    session.oauthState = undefined;
    await session.save();
    
    return NextResponse.json({ valid: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
```

### Updated: `app/auth/callback/page.tsx` (Using PUT for validation)

```tsx
"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check for OAuth errors in URL hash
    const hash = window.location.hash.substring(1);
    const hashParams = new URLSearchParams(hash);
    const errorParam = hashParams.get("error") || searchParams.get("error");
    const errorDescription = hashParams.get("error_description") || searchParams.get("error_description");

    if (errorParam) {
      const decodedError = errorDescription 
        ? decodeURIComponent(errorDescription.replace(/\+/g, " "))
        : "OAuth authorization failed";
      
      if (errorParam === "invalid_scope") {
        setError(
          `Scope Error: ${decodedError}. ` +
          "Your Connected App may not have 'offline_access' permission configured."
        );
      } else {
        setError(`OAuth Error: ${decodedError}`);
      }
      return;
    }

    const code = searchParams.get("code");
    const state = searchParams.get("state");

    if (!code || !state) {
      setError("Missing authorization code or state. Please try signing in again.");
      return;
    }

    // Validate state using PUT (atomic consume)
    fetch("/api/auth/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || "State validation failed");
        }
        return res.json();
      })
      .then((data) => {
        if (!data.valid) {
          setError("Invalid state parameter. Please try signing in again.");
          return;
        }

        // State validated and consumed, proceed with token exchange
        return fetch("/api/auth/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
      })
      .then(async (res) => {
        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.message || "Token exchange failed");
        }
        return res.json();
      })
      .then(() => {
        router.push("/");
      })
      .catch((err) => {
        setError(err.message || "Authentication failed. Please try again.");
      });
  }, [searchParams, router]);

  if (error) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-4">
          <h2 className="text-2xl font-semibold text-gray-900">Authentication Error</h2>
          <p className="text-red-600">{error}</p>
          <a
            href="/auth/sign-in"
            className="inline-block px-6 py-2 bg-primary text-white rounded-anypoint-button hover:bg-indigo-600 transition-colors"
          >
            Try Again
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center">
        <p className="text-gray-600">Completing sign-in...</p>
      </div>
    </div>
  );
}

export default function CallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-white flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-600">Completing sign-in...</p>
          </div>
        </div>
      }
    >
      <CallbackContent />
    </Suspense>
  );
}
```

---

## 3. API Route with Zod Validation

### File: `app/api/broker-tasks/route.ts` (Refactored POST handler)

```tsx
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, isAuthenticated } from "@/lib/session";
import { sessionOptions } from "@/lib/session";

// Request validation schema
const BrokerTasksRequestSchema = z.object({
  orgId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  apiInstanceId: z.string().min(1).max(200),
  timeRangeMs: z.number().int().positive().max(7 * 24 * 3600 * 1000).optional(),
});

// Response schema (for type safety)
const BrokerTasksResponseSchema = z.object({
  tasks: z.array(z.object({
    taskId: z.string(),
    apiInstanceId: z.string(),
    // ... other task fields
  })),
  totalTasks: z.number(),
  source: z.string(),
});

export async function POST(request: NextRequest) {
  try {
    // Authentication check
    if (!(await isAuthenticated())) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }
    
    const session = await getSession();
    
    // Check session invalidation
    if (session.invalidatedAt) {
      return NextResponse.json(
        { error: "Session invalidated" },
        { status: 401 }
      );
    }
    
    if (!session.accessToken) {
      return NextResponse.json(
        { error: "Not signed in" },
        { status: 401 }
      );
    }
    
    // Parse and validate request body
    const body = await request.json();
    const parseResult = BrokerTasksRequestSchema.safeParse(body);
    
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          details: parseResult.error.format(),
        },
        { status: 400 }
      );
    }
    
    const { orgId, apiInstanceId, timeRangeMs = 24 * 3600 * 1000 } = parseResult.data;
    const baseUrl = session.baseUrl ?? DEFAULT_BASE_URL;
    
    // Proceed with validated, type-safe data
    // ... rest of your implementation
    
    // Validate response before returning
    const responseData = {
      tasks: [], // Your actual tasks
      totalTasks: 0,
      source: "elasticsearch",
    };
    
    const validatedResponse = BrokerTasksResponseSchema.safeParse(responseData);
    if (!validatedResponse.success) {
      console.error("Response validation failed:", validatedResponse.error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
    
    return NextResponse.json(validatedResponse.data);
  } catch (error) {
    console.error("Broker tasks API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
```

---

## 4. React 19 use() Hook Pattern

### File: `components/BrokersList.tsx` (New component using React 19 patterns)

```tsx
"use client";

import { use, useMemo, Suspense } from "react";
import { z } from "zod";

// Response schema for type safety
const BrokersResponseSchema = z.object({
  brokers: z.array(z.object({
    nodeId: z.string(),
    assetId: z.string(),
    name: z.string(),
    // ... other broker fields
  })),
  error: z.string().optional(),
});

type Broker = z.infer<typeof BrokersResponseSchema>["brokers"][number];

interface BrokersListProps {
  orgId: string;
  envId: string;
  onBrokerSelect?: (broker: Broker) => void;
}

/**
 * BrokersList using React 19 use() hook
 * Automatically integrates with Suspense boundaries
 */
function BrokersListContent({ orgId, envId, onBrokerSelect }: BrokersListProps) {
  // Create promise resource (memoized)
  const brokersResource = useMemo(() => {
    if (!orgId || !envId) {
      return Promise.resolve({ brokers: [] });
    }
    
    return fetch(`/api/brokers-in-environment?orgId=${orgId}&environmentId=${envId}`)
      .then(async (res) => {
        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.error || `Failed: ${res.status}`);
        }
        const data = await res.json();
        
        // Validate response with Zod
        const validated = BrokersResponseSchema.safeParse(data);
        if (!validated.success) {
          throw new Error("Invalid response format");
        }
        
        return validated.data;
      });
  }, [orgId, envId]);
  
  // Use React 19's use() hook (throws promise for Suspense)
  const data = use(brokersResource);
  
  if (data.error) {
    return <div className="text-red-600">Error: {data.error}</div>;
  }
  
  if (data.brokers.length === 0) {
    return <div className="text-gray-500">No brokers found</div>;
  }
  
  return (
    <ul className="space-y-2">
      {data.brokers.map((broker) => (
        <li
          key={broker.nodeId}
          onClick={() => onBrokerSelect?.(broker)}
          className="cursor-pointer hover:bg-gray-100 p-2 rounded"
        >
          {broker.name}
        </li>
      ))}
    </ul>
  );
}

/**
 * Wrapper component with Suspense boundary
 */
export default function BrokersList(props: BrokersListProps) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center p-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <span className="ml-2 text-gray-600">Loading brokers...</span>
        </div>
      }
    >
      <BrokersListContent {...props} />
    </Suspense>
  );
}
```

### Updated: `components/MainContent.tsx` (Using new BrokersList)

```tsx
// ... existing imports ...
import BrokersList from "@/components/BrokersList";

export default function MainContent() {
  // ... existing state ...
  
  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <LeftSidebar
        onOrgAndEnvChange={handleOrgAndEnvChange}
        onActivityPeriodChange={handleActivityPeriodChange}
        brokers={brokers}
        onBrokerChange={handleBrokerChange}
        selectedTaskId={selectedTaskId}
        onTaskSelect={handleTaskSelect}
        loadingBrokers={loading}
      />
      {/* ... rest of component ... */}
    </div>
  );
}
```

---

## 5. Safe JSON Parsing with Zod

### File: `lib/parsers.ts` (New utility file)

```tsx
import { z } from "zod";

// Profile schema
const ProfileSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  username: z.string(),
  email: z.string().email().optional(),
  organization: z.object({
    name: z.string(),
  }).optional(),
});

export type Profile = z.infer<typeof ProfileSchema>;

/**
 * Safely parse JSON with Zod validation
 * Returns null on parse/validation failure
 */
export function parseProfile(raw: string): Profile | null {
  try {
    const parsed = JSON.parse(raw);
    const result = ProfileSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Generic safe JSON parser with schema validation
 */
export function safeParseJson<T>(
  raw: string,
  schema: z.ZodSchema<T>
): T | null {
  try {
    const parsed = JSON.parse(raw);
    const result = schema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
```

### Updated: `components/Header.tsx` (Using safe parser)

```tsx
import { parseProfile } from "@/lib/parsers";

// ... existing code ...

function getCachedProfile(): Profile | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("profile_cache");
  if (!raw) return null;
  
  return parseProfile(raw); // Safe parsing with validation
}

// ... rest of component ...
```

---

## 6. Fixed Token Route (No Double Cookie Setting)

### File: `app/api/auth/token/route.ts` (Refactored)

```tsx
import { NextRequest, NextResponse } from "next/server";
import { sealData } from "iron-session";
import { cookies } from "next/headers";
import { z } from "zod";
import { getCredentialsForRegion } from "@/lib/regions";
import type { RegionId } from "@/lib/regions";
import { loggedFetch } from "@/lib/api-logger";
import { sessionOptions, type SessionData } from "@/lib/session";

// Request validation
const TokenRequestSchema = z.object({
  code: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parseResult = TokenRequestSchema.safeParse(body);
    
    if (!parseResult.success) {
      return NextResponse.json(
        { message: "Authorization code is required" },
        { status: 400 }
      );
    }
    
    const { code } = parseResult.data;
    
    const cookieStore = await cookies();
    const region = (cookieStore.get("anypoint_signin_region")?.value ?? "us") as RegionId;
    const creds = getCredentialsForRegion(region);
    
    if (!creds) {
      return NextResponse.json(
        { message: "Invalid or unsupported region for sign-in" },
        { status: 400 }
      );
    }
    
    const redirectUri = `${request.nextUrl.origin}/auth/callback`;
    const tokenUrl = `${creds.baseUrl}/accounts/api/v2/oauth2/token`;
    
    const tokenResponse = await loggedFetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      }),
    });
    
    if (!tokenResponse.ok) {
      return NextResponse.json(
        { message: "Failed to exchange authorization code" },
        { status: tokenResponse.status }
      );
    }
    
    const tokenData = await tokenResponse.json();
    
    // Prepare session data
    const sessionData: SessionData = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000),
      baseUrl: creds.baseUrl,
      invalidatedAt: undefined, // Explicitly clear any previous invalidation
    };
    
    const sealed = await sealData(sessionData, sessionOptions);
    
    const cookieOptions = sessionOptions.cookieOptions;
    const secure = cookieOptions.secure ?? (process.env.NODE_ENV === "production");
    const sameSite = cookieOptions.sameSite ?? "lax";
    
    // Create response
    const response = NextResponse.json({ success: true });
    
    // Set session cookie ONLY on response (Next.js 15 pattern)
    response.cookies.set("ant_session", sealed, {
      httpOnly: cookieOptions.httpOnly ?? true,
      secure: secure,
      sameSite: sameSite,
      maxAge: cookieOptions.maxAge ?? 90 * 24 * 60 * 60,
      path: "/",
    });
    
    // Delete region cookie (no longer needed)
    response.cookies.delete("anypoint_signin_region");
    
    return response;
  } catch (error) {
    console.error("Token exchange error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}
```

---

## Implementation Checklist

- [ ] Create unified `lib/session.ts` with Zod validation
- [ ] Delete `lib/auth/session.ts` (consolidate)
- [ ] Update all imports to use unified session
- [ ] Fix `app/api/auth/state/route.ts` race condition
- [ ] Update `app/auth/callback/page.tsx` to use PUT for state validation
- [ ] Add Zod schemas to all API routes
- [ ] Create `lib/parsers.ts` for safe JSON parsing
- [ ] Update all `JSON.parse()` calls to use safe parsers
- [ ] Fix `app/api/auth/token/route.ts` double cookie setting
- [ ] Migrate one component to React 19 `use()` hook (pilot)
- [ ] Add error boundaries for Suspense
- [ ] Write tests for session race conditions
- [ ] Write tests for Zod validation

---

*Examples completed: February 17, 2026*
