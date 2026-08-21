"use client";

import Link from "next/link";
import { useRef, useState, useEffect } from "react";
import {
  REGIONS,
  getAvailableRegions,
  CONTROL_PLANE_DOCS_URL,
  type RegionId,
} from "@/lib/regions";
import PrivacyPolicyModal from "@/components/PrivacyPolicyModal";
import { PRIVACY_ACCEPT_STORAGE_KEY } from "@/components/PrivacyPolicyModal";
import { storePostAuthRedirect } from "@/lib/post-auth-redirect";
import { safeRedirectPath } from "@/lib/safe-redirect";

function getStoredPrivacyAccepted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(PRIVACY_ACCEPT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function ControlPlaneSignIn({
  defaultRegion = "us",
  configuredRegions,
  oauthRegions,
  redirectPath,
}: {
  defaultRegion?: RegionId;
  configuredRegions?: RegionId[];
  oauthRegions?: RegionId[];
  /** Post-sign-in destination (stored before OAuth redirect). */
  redirectPath?: string;
}) {
  void oauthRegions;
  useEffect(() => {
    if (redirectPath) {
      storePostAuthRedirect(safeRedirectPath(redirectPath));
    }
  }, [redirectPath]);

  return (
    <div className="w-full max-w-sm">
      <div className="rounded-2xl border border-gray-200/50 bg-white/90 backdrop-blur-sm p-6 shadow-xl hover:shadow-2xl transition-all duration-300">
        <WebOAuthSignIn
          defaultRegion={defaultRegion}
          configuredRegions={configuredRegions}
          redirectPath={redirectPath}
        />
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
