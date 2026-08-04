import { NextRequest, NextResponse } from "next/server";
import { loggedFetch, debugError } from "@/lib/api-logger";
import { requireAuth } from "@/lib/api/auth-middleware";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const resolvedParams = await params;
  return proxyRequest(request, resolvedParams, "GET");
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const resolvedParams = await params;
  return proxyRequest(request, resolvedParams, "POST");
}

async function proxyRequest(
  request: NextRequest,
  params: { path: string[] },
  method: "GET" | "POST"
) {
  // Authentication check
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  
  const { baseUrl, accessToken } = authResult;

  // Guard against path-traversal pivots out of /visualizer/api/ (e.g. `..`
  // segments that could rewrite the URL onto other Anypoint APIs).
  if (params.path.some((seg) => seg === ".." || seg === "." || seg.includes("\\"))) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const path = params.path.join("/");
  const url = `${baseUrl}/visualizer/api/${path}`;

  try {
    const headers: HeadersInit = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (method === "POST") {
      const body = await request.text();
      options.body = body || undefined;
    }

    const res = await loggedFetch(url, options);

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Visualizer API failed: ${res.status} ${text.slice(0, 200)}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    debugError("Visualizer API proxy error:", error);
    return NextResponse.json(
      { error: "Failed to fetch from Visualizer API" },
      { status: 500 }
    );
  }
}
