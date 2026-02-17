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

function getStoredPrivacyAccepted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(PRIVACY_ACCEPT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function ControlPlaneSignIn() {
  const available = getAvailableRegions();
  const [region, setRegion] = useState(available[0]?.id ?? "us");
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [privacyModalOpen, setPrivacyModalOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);

  // Ensure component is mounted and restore privacy acceptance from storage (set only via modal or /privacy page)
  useEffect(() => {
    setMounted(true);
    setPrivacyAccepted(getStoredPrivacyAccepted());
  }, []);

  const handleSignInClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    console.log("[SIGN-IN] Button clicked, region:", region);
    
    const currentRegion = (selectRef.current?.value ?? region) as "us" | "eu" | "ca" | "jp";
    const regionOption = REGIONS.find((r: { id: string; available: boolean }) => r.id === currentRegion);
    
    console.log("[SIGN-IN] Current region:", currentRegion, "available:", regionOption?.available);
    
    // Prevent sign-in if privacy policy not accepted (must accept via modal or /privacy page)
    if (!privacyAccepted) {
      console.log("[SIGN-IN] Privacy policy not accepted, aborting");
      return;
    }
    if (!regionOption?.available) {
      console.log("[SIGN-IN] Region not available, aborting");
      return;
    }
    
    const signInUrl = `/auth/sign-in?region=${currentRegion}`;
    console.log("[SIGN-IN] Navigating to:", signInUrl);
    
    // Use window.location.href for reliable navigation
    window.location.href = signInUrl;
  };

  // Don't render until mounted to avoid hydration issues
  if (!mounted) {
    return (
      <div className="w-full max-w-sm">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4">
            <div className="h-10 animate-pulse bg-gray-200 rounded"></div>
            <div className="h-10 animate-pulse bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <label
              htmlFor="control-plane"
              className="shrink-0 text-sm font-medium text-gray-600"
            >
              Control plane
            </label>
            <div className="relative group flex flex-1 items-center gap-1.5">
              <select
                ref={selectRef}
                id="control-plane"
                value={region}
                onChange={(e) =>
                  setRegion(e.target.value as "us" | "eu" | "ca" | "jp")
                }
                className="min-w-0 flex-1 rounded-anypoint border border-gray-300 bg-white px-3 py-2 pr-8 text-sm text-gray-900 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                aria-describedby="control-plane-help"
              >
                {REGIONS.map((r: { id: string; label: string; available: boolean }) => (
                  <option
                    key={r.id}
                    value={r.id}
                    disabled={!r.available}
                  >
                    {r.label}
                    {!r.available ? " (Coming soon)" : ""}
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
                Control planes determine where your Anypoint data lives (US vs
                EU).{" "}
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
              <p className="text-sm text-gray-600">
                To sign in, you must read and accept the Privacy Policy.
              </p>
              <button
                type="button"
                onClick={() => setPrivacyModalOpen(true)}
                className="block w-full rounded-anypoint border border-primary bg-white px-4 py-2.5 text-center text-sm font-medium text-primary hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
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
                  !REGIONS.find((r: { id: string; available: boolean }) => r.id === region)
                    ?.available
                }
                className="block w-full rounded-anypoint-button bg-primary px-6 py-3 text-center text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-600 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary"
                aria-label="Sign in with Anypoint Platform"
              >
                Sign in with Anypoint
              </button>
            </>
          )}
        </div>
      </div>
      <PrivacyPolicyModal
        open={privacyModalOpen}
        onClose={() => setPrivacyModalOpen(false)}
        onAccept={() => {
          setPrivacyAccepted(true);
          setPrivacyModalOpen(false);
        }}
      />
    </div>
  );
}
