import type { FeedbackGitHubConfig } from "@/lib/feedback/config";

interface CreateIssueResult {
  issueNumber: number;
  issueUrl: string;
}

export async function createGitHubIssue(
  config: FeedbackGitHubConfig,
  title: string,
  body: string,
  labels: string[] = ["bug", "user-report"]
): Promise<CreateIssueResult> {
  const res = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/issues`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ title, body, labels }),
    }
  );

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub issue creation failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const json = JSON.parse(text) as { number?: number; html_url?: string };
  if (!json.number || !json.html_url) {
    throw new Error("GitHub issue creation returned an unexpected response.");
  }

  return { issueNumber: json.number, issueUrl: json.html_url };
}

export async function attachScreenshotComment(
  config: FeedbackGitHubConfig,
  issueNumber: number,
  pngBytes: Buffer
): Promise<void> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(pngBytes)], { type: "image/png" }),
    "screenshot.png"
  );

  const res = await fetch(
    `https://uploads.github.com/repos/${config.owner}/${config.repo}/issues/${issueNumber}/comments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: form,
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Screenshot upload failed (${res.status}): ${text.slice(0, 200)}`);
  }
}

export function decodeDataUrl(dataUrl: string): Buffer | null {
  const match = /^data:image\/png;base64,(.+)$/i.exec(dataUrl.trim());
  if (!match?.[1]) return null;
  try {
    return Buffer.from(match[1], "base64");
  } catch {
    return null;
  }
}
