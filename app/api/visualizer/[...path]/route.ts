import { NextRequest, NextResponse } from "next/server";
import { getSession, isAuthenticated } from "@/lib/session";
import { loggedFetch, debugError } from "@/lib/api-logger";

export const dynamic = "force-dynamic";

const DEFAULT_BASE_URL = "https://anypoint.mulesoft.com";

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
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  
  const session = await getSession();
  
  if (session.invalidatedAt || !session.accessToken) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const baseUrl = session.baseUrl ?? DEFAULT_BASE_URL;
  const path = params.path.join("/");
  const url = `${baseUrl}/visualizer/api/${path}`;

  try {
    const headers: HeadersInit = {
      Authorization: `Bearer ${session.accessToken}`,
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
        { error: `Visualizer API failed: ${res.status} ${text}` },
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
