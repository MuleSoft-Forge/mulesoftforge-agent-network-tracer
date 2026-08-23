"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { consumePostAuthRedirect } from "@/lib/post-auth-redirect";

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  // State validation and code exchange are both one-time-use server side, so a
  // second invocation (React Strict Mode's dev double-invoke, or any other
  // re-run of this effect) must not repeat them — it would either see the
  // state already consumed or redeem an already-redeemed code.
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    // Check for OAuth errors in URL hash (Anypoint uses hash fragments for errors)
    const hash = window.location.hash.substring(1);
    const hashParams = new URLSearchParams(hash);
    const errorParam = hashParams.get("error") || searchParams.get("error");
    const errorDescription = hashParams.get("error_description") || searchParams.get("error_description");

    // Check for OAuth errors first
    if (errorParam) {
      const decodedError = errorDescription 
        ? decodeURIComponent(errorDescription.replace(/\+/g, " "))
        : "OAuth authorization failed";
      
      if (errorParam === "invalid_scope") {
        setError(
          `Scope Error: ${decodedError}. ` +
          "Your Connected App may not have 'offline_access' permission configured. " +
          "You can still use the app, but sessions will expire when the access token expires."
        );
      } else {
        setError(`OAuth Error: ${decodedError}`);
      }
      return;
    }

    const code = searchParams.get("code");
    const state = searchParams.get("state");

    if (!code || !state) {
      setError("Missing authorization code or state. Please try signing in again.");
      return;
    }

    // Validate state using PUT (atomic consume)
    fetch("/api/auth/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || "State validation failed");
        }
        return res.json();
      })
      .then((data) => {
        if (!data.valid) {
          setError("Invalid state parameter. Please try signing in again.");
          return;
        }

        // State validated and consumed, proceed with token exchange
        return fetch("/api/auth/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
      })
      .then(async (res) => {
        if (!res) {
          return; // Early return if previous step failed
        }
        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.message || "Token exchange failed");
        }
        return res.json();
      })
      .then(() => {
        router.push(consumePostAuthRedirect());
      })
      .catch((err) => {
        setError(err.message || "Authentication failed. Please try again.");
      });
  }, [searchParams, router]);

  if (error) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-4">
          <h2 className="text-2xl font-semibold text-gray-900">Authentication Error</h2>
          <p className="text-red-600">{error}</p>
          <a
            href="/auth/sign-in"
            className="inline-block px-6 py-2 bg-primary text-white rounded-anypoint-button hover:bg-indigo-600 transition-colors"
          >
            Try Again
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center">
        <p className="text-gray-600">Completing sign-in...</p>
      </div>
    </div>
  );
}

export default function CallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-white flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-600">Completing sign-in...</p>
          </div>
        </div>
      }
    >
      <CallbackContent />
    </Suspense>
  );
}
