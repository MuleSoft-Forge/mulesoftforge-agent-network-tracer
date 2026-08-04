import type { LlmBinding } from "@/lib/composer/model";

type Scalar = string | number | boolean;

/** Map a yaml key under `llm.<name>:` into typed binding fields or leftover params. */
export function applyLlmYamlParam(target: Partial<LlmBinding>, key: string, value: Scalar): void {
  switch (key) {
    case "reasoning_effort":
      target.reasoningEffort = String(value) as LlmBinding["reasoningEffort"];
      return;
    case "thinking_level":
      target.thinkingLevel = String(value) as LlmBinding["thinkingLevel"];
      return;
    case "temperature":
      target.temperature = Number(value);
      return;
    case "top_p":
      target.topP = Number(value);
      return;
    case "top_logprobs":
      target.topLogprobs = Number(value);
      return;
    case "max_output_tokens":
      target.maxOutputTokens = Number(value);
      return;
    case "thinking_budget":
      target.thinkingBudget = Number(value);
      return;
    case "response_logprobs":
      target.responseLogprobs = value === true || value === "true";
      return;
    default:
      target.params = target.params ?? {};
      target.params[key] = value;
  }
}

/** Emit provider tuning keys for serialize/broker-agent.ts. */
export function llmTuningYamlEntries(binding: LlmBinding): Array<[string, Scalar]> {
  const entries: Array<[string, Scalar]> = [];
  if (binding.reasoningEffort) entries.push(["reasoning_effort", binding.reasoningEffort]);
  if (binding.thinkingLevel) entries.push(["thinking_level", binding.thinkingLevel]);
  if (binding.temperature !== undefined) entries.push(["temperature", binding.temperature]);
  if (binding.topP !== undefined) entries.push(["top_p", binding.topP]);
  if (binding.topLogprobs !== undefined) entries.push(["top_logprobs", binding.topLogprobs]);
  if (binding.maxOutputTokens !== undefined) entries.push(["max_output_tokens", binding.maxOutputTokens]);
  if (binding.thinkingBudget !== undefined) entries.push(["thinking_budget", binding.thinkingBudget]);
  if (binding.responseLogprobs !== undefined) entries.push(["response_logprobs", binding.responseLogprobs]);
  return entries;
}
