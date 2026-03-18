import { NextResponse } from "next/server";
import { getSession, isAuthenticated } from "@/lib/session";
import { loggedFetch, debugError } from "@/lib/api-logger";
import { DEFAULT_BASE_URL } from "@/lib/constants";

// Deduplication: Track recent webhook calls to prevent duplicate logging
// Key: username, Value: timestamp of last webhook call
const recentWebhookCalls = new Map<string, number>();
const WEBHOOK_DEDUP_WINDOW_MS = 5000; // 5 seconds

export async function GET() {
  // Authentication check
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  
  const session = await getSession();
  
  if (session.invalidatedAt || !session.accessToken) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const baseUrl = session.baseUrl ?? DEFAULT_BASE_URL;

  try {
    const res = await loggedFetch(`${baseUrl}/accounts/api/profile`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Profile failed: ${res.status} ${text}` },
        { status: res.status }
      );
    }

    const profile = await res.json();
    
    // Call webhook to log user access (non-blocking - don't fail profile request if webhook fails)
    // Deduplication: Only call webhook if not called recently for this user
    try {
      const username = profile.username || "unknown";
      const now = Date.now();
      const lastCallTime = recentWebhookCalls.get(username);
      
      // Only call webhook if not called within the dedup window
      if (!lastCallTime || (now - lastCallTime) > WEBHOOK_DEDUP_WINDOW_MS) {
        recentWebhookCalls.set(username, now);
        
        // Clean up old entries (keep map size reasonable)
        if (recentWebhookCalls.size > 1000) {
          const cutoff = now - WEBHOOK_DEDUP_WINDOW_MS;
          for (const [key, value] of recentWebhookCalls.entries()) {
            if (value < cutoff) {
              recentWebhookCalls.delete(key);
            }
          }
        }
        
        const webhookPayload = {
          binType: "ant",
          email: profile.email || null,
          username: profile.username || null,
          first_name: profile.firstName || null,
          last_name: profile.lastName || null,
          org_id: profile.organization?.id || null,
          org_name: profile.organization?.name || null,
        };
        
        // Fire and forget - always call webhook regardless of logging settings
        fetch("https://json-black-hole-app-9sqczt.m3jzw3-2.deu-c1.cloudhub.io/api/webhook", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(webhookPayload),
        }).catch((err) => {
          // Silently log webhook errors but don't fail the profile request
          debugError("[WEBHOOK] Failed to send user access webhook:", err);
        });
      }
    } catch (webhookError) {
      // Silently log webhook errors but don't fail the profile request
      debugError("[WEBHOOK] Error preparing webhook payload:", webhookError);
    }
    
    return NextResponse.json(profile);
  } catch (error) {
    debugError("Profile fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch profile" },
      { status: 500 }
    );
  }
}
