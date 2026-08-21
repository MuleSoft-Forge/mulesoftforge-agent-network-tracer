/**
 * Default LLM connection base URLs from the Agent Network yaml reference
 * (context.connections.url for kind: llm).
 *
 * @see https://docs.mulesoft.com/agent-network/latest/af-agent-network-yaml-reference#connections
 */
export type LlmConnectionPlatform = "OpenAI" | "Gemini" | "AzureOpenai" | "BedrockOpenAI";

export const LLM_DEFAULT_BASE_URLS: Record<LlmConnectionPlatform, string> = {
  OpenAI: "https://api.openai.com/v1",
  Gemini: "https://generativelanguage.googleapis.com",
  BedrockOpenAI: "https://bedrock-mantle.<YOUR_REGION>.api.aws/v1",
  AzureOpenai: "https://<YOUR_RESOURCE_NAME>.openai.azure.com/openai/v1",
};

export const LLM_DEFAULT_BASE_URL_DOCS =
  "https://docs.mulesoft.com/agent-network/latest/af-agent-network-yaml-reference#connections";

export interface LlmPlatformHintInput {
  name?: string;
  assetId?: string;
  description?: string;
}

/** Best-effort platform guess from asset naming — used for default URL selection. */
export function inferLlmPlatform(input: LlmPlatformHintInput): LlmConnectionPlatform {
  const hay = `${input.name ?? ""} ${input.assetId ?? ""} ${input.description ?? ""}`.toLowerCase();
  if (hay.includes("gemini") || hay.includes("google")) return "Gemini";
  if (hay.includes("azure")) return "AzureOpenai";
  if (hay.includes("bedrock")) return "BedrockOpenAI";
  return "OpenAI";
}

export function defaultLlmBaseUrl(platform: LlmConnectionPlatform): string {
  return LLM_DEFAULT_BASE_URLS[platform];
}

export function defaultLlmBaseUrlForAsset(input: LlmPlatformHintInput): string {
  return defaultLlmBaseUrl(inferLlmPlatform(input));
}
