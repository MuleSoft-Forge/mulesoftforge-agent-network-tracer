/**
 * Client-side accessor for the signed-in user's Anypoint profile.
 *
 * `Header` and `BusinessGroupSelector` both need it and both mounted at once,
 * each with its own copy of the same `sessionStorage` helpers. Because each
 * checked the cache before either had written it, a cold load issued two
 * concurrent `/api/auth/profile` requests. Sharing the in-flight promise
 * collapses that to one regardless of how many components ask.
 */

import { parseProfile, type Profile } from "@/lib/parsers";
import { clearCachedEnvironments } from "@/lib/anypoint/environments-client";

const PROFILE_CACHE_KEY = "agent-network-profile";

let inFlight: Promise<Profile | null> | null = null;

export function readCachedProfile(): Profile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    return parseProfile(raw);
  } catch {
    return null;
  }
}

export function writeCachedProfile(profile: Profile | null): void {
  if (typeof window === "undefined") return;
  try {
    if (profile) {
      sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
    } else {
      sessionStorage.removeItem(PROFILE_CACHE_KEY);
    }
  } catch {
    /* sessionStorage full or unavailable — the network path still works */
  }
}

/**
 * Fetch the profile, sharing any request already in flight and updating the
 * session cache.
 *
 * This always revalidates against the server. Callers wanting an instant first
 * paint should read {@link readCachedProfile} for their initial state — that is
 * what makes the cache useful without making it authoritative. Serving the cache
 * *instead of* fetching would leave a stale account on screen after a re-login,
 * because the cache key carries no account identity and `sessionStorage` outlives
 * a reload. Deduplication is what avoids the duplicate request, not the cache.
 */
export function fetchProfile(): Promise<Profile | null> {
  if (inFlight) return inFlight;

  inFlight = fetch("/api/auth/profile")
    .then((res) => (res.ok ? (res.json() as Promise<Profile | null>) : null))
    .then((profile) => {
      const previous = readCachedProfile();
      if (previous != null && profile != null && previous.username !== profile.username) {
        clearCachedEnvironments();
      }
      writeCachedProfile(profile ?? null);
      return profile ?? null;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
