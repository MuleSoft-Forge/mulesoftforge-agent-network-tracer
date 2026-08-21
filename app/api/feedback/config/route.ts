import { NextResponse } from "next/server";
import { getFeedbackContactEmail, isFeedbackEnabled } from "@/lib/feedback/config";
import type { FeedbackConfigResponse } from "@/lib/feedback/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const body: FeedbackConfigResponse = {
    enabled: isFeedbackEnabled(),
    contactEmail: getFeedbackContactEmail(),
  };
  return NextResponse.json(body);
}
