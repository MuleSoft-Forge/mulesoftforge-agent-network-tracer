import { NextResponse } from "next/server";
import { FEEDBACK_CONTACT_EMAIL, isFeedbackEnabled } from "@/lib/feedback/config";
import type { FeedbackConfigResponse } from "@/lib/feedback/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const body: FeedbackConfigResponse = {
    enabled: isFeedbackEnabled(),
    contactEmail: FEEDBACK_CONTACT_EMAIL,
  };
  return NextResponse.json(body);
}
