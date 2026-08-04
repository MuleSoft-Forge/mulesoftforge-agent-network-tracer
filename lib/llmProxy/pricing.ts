/**
 * Approximate per-1K-token pricing for common providers, used by the LLM
 * Proxy Usage & Cost card. Prices are USD per 1K tokens. Values are
 * intentionally conservative and clearly labelled "Approximate" in the UI.
 *
 * Keep keys lower-cased; lookup is done with `findPricing()` which matches
 * the model string case-insensitively and supports common prefix variants
 * (e.g. an upstream reporting `openai/gpt-4o-mini` still hits the `gpt-4o-mini`
 * entry).
 */
export interface ModelPrice {
  /** USD per 1K input (prompt) tokens. */
  input: number;
  /** USD per 1K output (completion) tokens. */
  output: number;
}

export const MODEL_PRICING: Record<string, ModelPrice> = {
  // OpenAI (GPT-4o family)
  "gpt-4o": { input: 0.005, output: 0.015 },
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "gpt-4o-2024-05-13": { input: 0.005, output: 0.015 },
  "gpt-4-turbo": { input: 0.01, output: 0.03 },
  "gpt-4-turbo-preview": { input: 0.01, output: 0.03 },
  "gpt-4": { input: 0.03, output: 0.06 },
  "gpt-3.5-turbo": { input: 0.0005, output: 0.0015 },
  // GPT-5 family (approximate, adjust if pricing is confirmed)
  "gpt-5": { input: 0.0025, output: 0.01 },
  "gpt-5-mini": { input: 0.0001, output: 0.0004 },
  "gpt-5.2": { input: 0.003, output: 0.012 },
  // Azure-prefixed names (same upstream pricing)
  "azure/gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "azure/gpt-4o": { input: 0.005, output: 0.015 },
  // Anthropic
  "claude-3-5-sonnet": { input: 0.003, output: 0.015 },
  "claude-3-opus": { input: 0.015, output: 0.075 },
  "claude-3-sonnet": { input: 0.003, output: 0.015 },
  "claude-3-haiku": { input: 0.00025, output: 0.00125 },
  // Google
  "gemini-1.5-pro": { input: 0.00125, output: 0.005 },
  "gemini-1.5-flash": { input: 0.000075, output: 0.0003 },
};

/** Baseline for "% Cost Savings vs GPT-4 Turbo" copy in the UI. */
export const GPT4_TURBO_BASELINE: ModelPrice = { input: 0.01, output: 0.03 };

/**
 * Find a pricing entry for an arbitrary model string. Matches:
 *  1. exact (case-insensitive) key
 *  2. last slash-separated segment (e.g. `openai/gpt-4o-mini` -> `gpt-4o-mini`)
 *  3. longest key prefix (e.g. `gpt-4o-mini-2024-07-18` -> `gpt-4o-mini`)
 * Returns null when no match.
 */
export function findPricing(model: string | null | undefined): ModelPrice | null {
  if (!model) return null;
  const normalized = model.trim().toLowerCase();
  if (normalized.length === 0) return null;

  if (normalized in MODEL_PRICING) return MODEL_PRICING[normalized];

  const tail = normalized.split("/").pop() ?? normalized;
  if (tail in MODEL_PRICING) return MODEL_PRICING[tail];

  let best: { key: string; price: ModelPrice } | null = null;
  for (const [key, price] of Object.entries(MODEL_PRICING)) {
    if (normalized.startsWith(key) || tail.startsWith(key)) {
      if (!best || key.length > best.key.length) best = { key, price };
    }
  }
  return best?.price ?? null;
}

export interface CostComputation {
  /** Resolved pricing used (null when model wasn't recognised). */
  price: ModelPrice | null;
  /** Total cost in USD for the given usage (null when pricing is unknown). */
  costUsd: number | null;
  /** Equivalent cost on GPT-4 Turbo, USD. */
  baselineUsd: number;
  /** Percent saved vs GPT-4 Turbo (0-100). Null when pricing is unknown. */
  percentSaved: number | null;
}

/**
 * Compute the approximate cost and "% savings vs GPT-4 Turbo" for a given
 * token usage against a model.
 */
export function computeCost(
  model: string | null | undefined,
  promptTokens: number,
  completionTokens: number
): CostComputation {
  const price = findPricing(model);
  const baselineUsd =
    (promptTokens / 1000) * GPT4_TURBO_BASELINE.input +
    (completionTokens / 1000) * GPT4_TURBO_BASELINE.output;

  if (!price) {
    return { price: null, costUsd: null, baselineUsd, percentSaved: null };
  }

  const costUsd =
    (promptTokens / 1000) * price.input +
    (completionTokens / 1000) * price.output;
  const percentSaved =
    baselineUsd > 0 ? Math.max(0, ((baselineUsd - costUsd) / baselineUsd) * 100) : 0;
  return { price, costUsd, baselineUsd, percentSaved };
}
