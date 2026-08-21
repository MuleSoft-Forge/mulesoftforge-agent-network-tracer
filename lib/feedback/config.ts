export const FEEDBACK_CONTACT_EMAIL = "jeffcock@mulesoftforge.com";

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
