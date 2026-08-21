import { NextRequest, NextResponse } from "next/server";
import { apiError, validationError } from "@/lib/api/error-responses";
import { debugError } from "@/lib/api-logger";
import { MAX_SCREENSHOT_BYTES } from "@/lib/feedback/capture-screenshot";
import { getFeedbackContactEmail, getFeedbackGitHubConfig } from "@/lib/feedback/config";
import { buildIssueBody, buildIssueTitle } from "@/lib/feedback/format-issue";
import {
  attachScreenshotComment,
  createGitHubIssue,
  decodeDataUrl,
} from "@/lib/feedback/github-issue";
import { checkFeedbackRateLimit } from "@/lib/feedback/rate-limit";
import type { BugReportPayload, FeedbackSubmitResponse } from "@/lib/feedback/types";
import { FeedbackRequestSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

function clientRateLimitKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  return ip;
}

export async function POST(request: NextRequest) {
  const config = getFeedbackGitHubConfig();
  if (!config) {
    const contactEmail = getFeedbackContactEmail();
    return apiError(
      "Bug report submission is not configured on this deployment.",
      503,
      contactEmail ? `Email ${contactEmail} instead.` : undefined
    );
  }

  const rate = checkFeedbackRateLimit(clientRateLimitKey(request));
  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: "Too many bug reports. Try again later or email the maintainer.",
        retryAfterSec: rate.retryAfterSec,
      },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = FeedbackRequestSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const payload = parsed.data as BugReportPayload;

  if (payload.screenshotDataUrl) {
    const png = decodeDataUrl(payload.screenshotDataUrl);
    if (!png || png.length > MAX_SCREENSHOT_BYTES) {
      return apiError("Screenshot is invalid or too large.", 400);
    }
  }

  try {
    const title = buildIssueTitle(payload.description);
    const issueBody = buildIssueBody(payload);
    const created = await createGitHubIssue(config, title, issueBody);

    if (payload.screenshotDataUrl) {
      const png = decodeDataUrl(payload.screenshotDataUrl);
      if (png) {
        try {
          await attachScreenshotComment(config, created.issueNumber, png);
        } catch (uploadErr) {
          debugError("[Feedback] Screenshot upload failed:", uploadErr);
          // Issue still created — screenshot is optional.
        }
      }
    }

    const response: FeedbackSubmitResponse = {
      issueUrl: created.issueUrl,
      issueNumber: created.issueNumber,
    };
    return NextResponse.json(response);
  } catch (err) {
    debugError("[Feedback] GitHub issue creation failed:", err);
    return apiError(
      "Could not create the bug report. Try again or email the maintainer.",
      502
    );
  }
}
