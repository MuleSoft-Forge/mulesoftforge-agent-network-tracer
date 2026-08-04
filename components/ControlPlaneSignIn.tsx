"use client";

import Link from "next/link";
import { useRef, useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  REGIONS,
  getAvailableRegions,
  CONTROL_PLANE_DOCS_URL,
  type RegionId,
} from "@/lib/regions";
import { isDesktop, getDesktop } from "@/lib/desktop/bridge";
import PrivacyPolicyModal from "@/components/PrivacyPolicyModal";
import { PRIVACY_ACCEPT_STORAGE_KEY } from "@/components/PrivacyPolicyModal";
import { debugLog } from "@/lib/api-logger";
import { consumePostAuthRedirect, storePostAuthRedirect } from "@/lib/post-auth-redirect";
import { safeRedirectPath } from "@/lib/safe-redirect";

function getStoredPrivacyAccepted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(PRIVACY_ACCEPT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Desktop sign-in: Anypoint username/password (no Connected App secret in the app). */
function DesktopPasswordSignInForm({
  defaultRegion,
  configuredRegions,
  oauthRegions,
  redirectPath,
}: {
  defaultRegion: RegionId;
  configuredRegions: RegionId[];
  oauthRegions: RegionId[];
  redirectPath?: string;
}) {
  const router = useRouter();
  const available = getAvailableRegions();
  const configuredSet = new Set(configuredRegions.length > 0 ? configuredRegions : available.map((r) => r.id));
  const initialRegion = configuredSet.has(defaultRegion)
    ? defaultRegion
    : (configuredRegions[0] ?? available[0]?.id ?? "us");

  const [region, setRegion] = useState<RegionId>(initialRegion);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [privacyModalOpen, setPrivacyModalOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [staySignedIn, setStaySignedIn] = useState(true);
  const [secureStorageAvailable, setSecureStorageAvailable] = useState(true);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    setMounted(true);
    setPrivacyAccepted(getStoredPrivacyAccepted());
    void getDesktop()
      ?.auth.encryptionAvailable()
      .then((available) => setSecureStorageAvailable(available))
      .catch(() => setSecureStorageAvailable(false));
  }, []);

  const oauthAvailable = oauthRegions.includes(region);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!privacyAccepted || submitting) return;

    const currentRegion = (selectRef.current?.value ?? region) as RegionId;
    const regionOption = REGIONS.find((r) => r.id === currentRegion);
    if (!regionOption?.available || !configuredSet.has(currentRegion)) return;

    setSubmitting(true);
    setError(null);
    debugLog("[DESKTOP-SIGN-IN] password login, region:", currentRegion);

    try {
      const res = await fetch("/api/auth/password-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password, region: currentRegion }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        expiresAt?: number;
      };
      if (!res.ok) {
        setError(data.error ?? `Sign-in failed (${res.status}).`);
        return;
      }

      const desktop = getDesktop();
      if (desktop) {
        if (staySignedIn && secureStorageAvailable) {
          const saveResult = await desktop.auth.saveCredentials({
            username: username.trim(),
            password,
            region: currentRegion,
            expiresAt: data.expiresAt,
          });
          if (!saveResult.ok) {
            debugLog("[DESKTOP-SIGN-IN] secure storage save failed:", saveResult.error);
          }
        } else {
          await desktop.auth.clearCredentials();
        }
      }

      router.push(consumePostAuthRedirect(safeRedirectPath(redirectPath)));
      router.refresh();
    } catch {
      setError("Sign-in request failed. Check your network connection.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!mounted) {
    return (
      <div className="h-48 animate-pulse rounded-lg bg-gray-200" aria-hidden />
    );
  }

  return (
    <>
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <label htmlFor="desktop-control-plane" className="shrink-0 text-sm font-medium text-gray-600">
            Control plane
          </label>
          <select
            ref={selectRef}
            id="desktop-control-plane"
            value={region}
            onChange={(e) => setRegion(e.target.value as RegionId)}
            className="min-w-0 flex-1 rounded-anypoint border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {REGIONS.map((r) => (
              <option
                key={r.id}
                value={r.id}
                disabled={!r.available || !configuredSet.has(r.id as RegionId)}
              >
                {r.label}
                {!r.available ? " (Coming soon)" : !configuredSet.has(r.id as RegionId) ? " (Not available)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="desktop-username" className="mb-1 block text-sm font-medium text-gray-600">
            Anypoint username
          </label>
          <input
            id="desktop-username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded-anypoint border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            required
          />
        </div>

        <div>
          <label htmlFor="desktop-password" className="mb-1 block text-sm font-medium text-gray-600">
            Password
          </label>
          <input
            id="desktop-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-anypoint border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            required
          />
        </div>

        {error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        {privacyAccepted ? (
          <label className="flex cursor-pointer items-start gap-2 text-left text-sm text-gray-600">
            <input
              type="checkbox"
              checked={staySignedIn}
              onChange={(e) => setStaySignedIn(e.target.checked)}
              disabled={!secureStorageAvailable}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <span>
              Stay signed in — save credentials in your Mac/Windows secure keychain for silent
              re-authentication. Nothing is sent to Agent Network Studio servers.
              {!secureStorageAvailable ? (
                <span className="mt-1 block text-xs text-amber-700">
                  Secure storage is unavailable on this system; you will need to sign in again
                  when your session expires (~1 hour).
                </span>
              ) : null}
            </span>
          </label>
        ) : null}

        {!privacyAccepted ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">To sign in, you must read and accept the Privacy Policy.</p>
            <button
              type="button"
              onClick={() => setPrivacyModalOpen(true)}
              className="block w-full rounded-anypoint border-2 border-primary bg-white px-4 py-2.5 text-center text-sm font-medium text-primary hover:bg-primary/5"
            >
              Read Privacy Policy
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500">
              You have accepted the{" "}
              <Link href="/privacy" className="font-medium text-primary hover:underline">
                Privacy Policy
              </Link>
              . Credentials are sent only to your selected Anypoint control plane.
            </p>
            <button
              type="submit"
              disabled={submitting || !username.trim() || !password}
              className="block w-full rounded-anypoint-button bg-gradient-to-r from-primary to-purple-600 px-6 py-3 text-center text-sm font-medium text-white shadow-lg transition-all hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>
            {oauthAvailable ? (
              <p className="text-center text-xs text-gray-500">
                SSO org?{" "}
                <a
                  href={`/auth/sign-in?region=${region}${redirectPath ? `&redirect=${encodeURIComponent(safeRedirectPath(redirectPath))}` : ""}`}
                  className="font-medium text-primary hover:underline"
                >
                  Use Connected App sign-in
                </a>
              </p>
            ) : null}
          </>
        )}
      </form>

      <p className="mt-3 text-center text-[11px] text-gray-400">
        <a
          href={CONTROL_PLANE_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-gray-600 hover:underline"
        >
          About control planes
        </a>
      </p>

      <PrivacyPolicyModal
        open={privacyModalOpen}
        onClose={() => setPrivacyModalOpen(false)}
        onAccept={() => {
          setPrivacyAccepted(true);
          setPrivacyModalOpen(false);
        }}
      />
    </>
  );
}

export default function ControlPlaneSignIn({
  defaultRegion = "us",
  configuredRegions,
  oauthRegions = [],
  redirectPath,
}: {
  defaultRegion?: RegionId;
  configuredRegions?: RegionId[];
  /** Regions with Connected App creds — desktop OAuth fallback link. */
  oauthRegions?: RegionId[];
  /** Post-sign-in destination (stored before OAuth / used after password login). */
  redirectPath?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const desktop = mounted && isDesktop();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (redirectPath) {
      storePostAuthRedirect(safeRedirectPath(redirectPath));
    }
  }, [redirectPath]);

  if (!mounted) {
    return (
      <div className="w-full max-w-sm">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="h-40 animate-pulse bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <div className="rounded-2xl border border-gray-200/50 bg-white/90 backdrop-blur-sm p-6 shadow-xl hover:shadow-2xl transition-all duration-300">
        {desktop ? (
          <DesktopPasswordSignInForm
            defaultRegion={defaultRegion}
            configuredRegions={configuredRegions ?? []}
            oauthRegions={oauthRegions}
            redirectPath={redirectPath}
          />
        ) : (
          <WebOAuthSignIn
            defaultRegion={defaultRegion}
            configuredRegions={configuredRegions}
            redirectPath={redirectPath}
          />
        )}
      </div>
    </div>
  );
}

/** Web sign-in: redirect to Anypoint OAuth (Connected App). */
function WebOAuthSignIn({
  defaultRegion,
  configuredRegions,
  redirectPath,
}: {
  defaultRegion: RegionId;
  configuredRegions?: RegionId[];
  redirectPath?: string;
}) {
  const available = getAvailableRegions();
  const configuredSet = new Set(configuredRegions ?? available.map((r) => r.id));
  const initialRegion = configuredSet.has(defaultRegion)
    ? defaultRegion
    : (configuredRegions?.[0] ?? available[0]?.id ?? "us");
  const [region, setRegion] = useState<RegionId>(initialRegion);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [privacyModalOpen, setPrivacyModalOpen] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    setPrivacyAccepted(getStoredPrivacyAccepted());
  }, []);

  const handleSignInClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (!privacyAccepted) return;
    const currentRegion = (selectRef.current?.value ?? region) as RegionId;
    const regionOption = REGIONS.find((r) => r.id === currentRegion);
    if (!regionOption?.available || !configuredSet.has(currentRegion)) return;
    const destination = safeRedirectPath(redirectPath);
    storePostAuthRedirect(destination);
    window.location.href = `/auth/sign-in?region=${currentRegion}&redirect=${encodeURIComponent(destination)}`;
  };

  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <label htmlFor="control-plane" className="shrink-0 text-sm font-medium text-gray-600">
            Control plane
          </label>
          <div className="relative group flex flex-1 items-center gap-1.5">
            <select
              ref={selectRef}
              id="control-plane"
              value={region}
              onChange={(e) => setRegion(e.target.value as RegionId)}
              className="min-w-0 flex-1 rounded-anypoint border border-gray-300 bg-white px-3 py-2 pr-8 text-sm text-gray-900 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              aria-describedby="control-plane-help"
            >
              {REGIONS.map((r) => (
                <option
                  key={r.id}
                  value={r.id}
                  disabled={!r.available || !configuredSet.has(r.id as RegionId)}
                >
                  {r.label}
                  {!r.available ? " (Coming soon)" : !configuredSet.has(r.id as RegionId) ? " (Not configured)" : ""}
                </option>
              ))}
            </select>
            <span
              id="control-plane-help"
              className="inline-flex h-5 w-5 shrink-0 cursor-help items-center justify-center rounded-full border border-gray-300 bg-gray-50 text-gray-500"
              title="Learn about control planes"
              aria-label="Help: learn about control planes"
            >
              <span className="text-xs font-semibold">?</span>
            </span>
            <div
              role="tooltip"
              className="absolute bottom-full left-0 z-10 mb-1 hidden max-w-[260px] rounded border border-gray-200 bg-white px-3 py-2 text-left text-sm text-gray-600 shadow-md group-hover:block"
            >
              Control planes determine where your Anypoint data lives (US vs EU).{" "}
              <a
                href={CONTROL_PLANE_DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary hover:underline"
              >
                Learn more
              </a>
            </div>
          </div>
        </div>
        {!privacyAccepted ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">To sign in, you must read and accept the Privacy Policy.</p>
            <button
              type="button"
              onClick={() => setPrivacyModalOpen(true)}
              className="block w-full rounded-anypoint border-2 border-primary bg-white px-4 py-2.5 text-center text-sm font-medium text-primary hover:bg-gradient-to-r hover:from-primary/5 hover:to-purple-500/5 hover:border-primary/80 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-all duration-200"
            >
              Read Privacy Policy
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500">
              You have accepted the{" "}
              <Link
                href="/privacy"
                className="font-medium text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 rounded"
              >
                Privacy Policy
              </Link>
              .
            </p>
            <button
              type="button"
              onClick={handleSignInClick}
              disabled={
                !REGIONS.find(
                  (r) => r.id === region && r.available && configuredSet.has(r.id as RegionId)
                )
              }
              className="block w-full rounded-anypoint-button bg-gradient-to-r from-primary to-purple-600 px-6 py-3 text-center text-sm font-medium text-white shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary disabled:hover:scale-100"
              aria-label="Sign in with Anypoint Platform"
            >
              Sign in with Anypoint
            </button>
          </>
        )}
      </div>
      <PrivacyPolicyModal
        open={privacyModalOpen}
        onClose={() => setPrivacyModalOpen(false)}
        onAccept={() => {
          setPrivacyAccepted(true);
          setPrivacyModalOpen(false);
        }}
      />
    </>
  );
}
