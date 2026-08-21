/**
 * Fallback contact address, offered when GitHub issue filing is unavailable.
 *
 * Read from the environment rather than hardcoded: this repository is public, so
 * a literal address here would be scraped straight out of source. Returns null
 * when unset, and callers then omit the contact affordance entirely instead of
 * rendering a dead mailto link.
 */
export function getFeedbackContactEmail(): string | null {
  return process.env.FEEDBACK_CONTACT_EMAIL?.trim() || null;
}

export const DEFAULT_FEEDBACK_REPO = "MuleSoft-Forge/mulesoftforge-agent-network-tracer";

export interface FeedbackGitHubConfig {
  token: string;
  owner: string;
  repo: string;
}

export function getFeedbackGitHubConfig(): FeedbackGitHubConfig | null {
  const token = process.env.GITHUB_FEEDBACK_TOKEN?.trim();
  if (!token) return null;

  const repoPath =
    process.env.GITHUB_FEEDBACK_REPO?.trim() || DEFAULT_FEEDBACK_REPO;
  const [owner, repo] = repoPath.split("/");
  if (!owner || !repo) return null;

  return { token, owner, repo };
}

export function isFeedbackEnabled(): boolean {
  return getFeedbackGitHubConfig() !== null;
}
