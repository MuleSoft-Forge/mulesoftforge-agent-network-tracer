/**
 * Safe JSON parsing utilities with Zod validation
 * Prevents runtime errors and type confusion attacks
 */

import { z } from "zod";
import { ProfileSchema, type Profile } from "./schemas";

// Re-export Profile type for convenience
export type { Profile };

/**
 * Safely parse JSON with Zod validation
 * Returns null on parse/validation failure
 */
export function parseProfile(raw: string): Profile | null {
  try {
    const parsed = JSON.parse(raw);
    const result = ProfileSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Generic safe JSON parser with schema validation
 */
export function safeParseJson<T>(
  raw: string,
  schema: z.ZodSchema<T>
): T | null {
  try {
    const parsed = JSON.parse(raw);
    const result = schema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Parse JSON with error handling
 * Returns parsed object or null on failure
 */
export function parseJson<T = unknown>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
