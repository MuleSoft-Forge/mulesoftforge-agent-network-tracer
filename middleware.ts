import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { hasValidSession } from "@/lib/auth/middleware-session";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes that don't require authentication - allow through immediately
  const publicRoutes = [
    "/",
    "/auth/sign-in",
    "/auth/callback",
    "/about",
    "/help",
    "/privacy",
  ];

  // Check if route is public first
  if (publicRoutes.includes(pathname)) {
    // Allow sign-in to proceed even if cookie exists - route handler will check if session is valid/invalidated
    // This is important for corporate governance scenarios where cookie deletion is prevented
    // The sign-in route handler will check for invalidation and allow OAuth flow if needed
    return NextResponse.next();
  }

  // Legacy slug → Builder
  if (pathname === "/compose" || pathname.startsWith("/compose/")) {
    const url = request.nextUrl.clone();
    url.pathname = `/builder${pathname.slice("/compose".length)}`;
    return NextResponse.redirect(url);
  }

  // Protect authenticated app routes under /(app)
  if (
    pathname.startsWith("/agent-network") ||
    pathname.startsWith("/builder") ||
    pathname.startsWith("/lifecycle")
  ) {
    if (!(await hasValidSession(request))) {
      const signInUrl = new URL("/", request.url);
      signInUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(signInUrl);
    }
    return NextResponse.next();
  }

  // Protect API routes (except /api/auth/*)
  if (pathname.startsWith("/api/") && !pathname.startsWith("/api/auth/")) {
    if (!(await hasValidSession(request))) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Allow all other routes through (static files, etc.)
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public directory)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
