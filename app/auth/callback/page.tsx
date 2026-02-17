"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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

    // Fetch stored state from server (cookie)
    fetch("/api/auth/state")
      .then(async (res) => {
        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`Failed to fetch state: ${res.status} ${errorText}`);
        }
        return res.json();
      })
      .then((data) => {
        const storedState = data.state;

        // Validate state (CSRF protection)
        if (!storedState) {
          setError("No stored state found. The sign-in session may have expired. Please try signing in again.");
          return;
        }
        if (state !== storedState) {
          setError(`Invalid state parameter. Expected: ${storedState?.substring(0, 10)}..., got: ${state?.substring(0, 10)}... Please try signing in again.`);
          return;
        }

        // Exchange code for token
        fetch("/api/auth/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ code }),
        })
          .then(async (res) => {
            if (!res.ok) {
              const error = await res.json();
              throw new Error(error.message || "Token exchange failed");
            }
            return res.json();
          })
          .then(() => {
            // Redirect to home page after successful authentication
            router.push("/");
          })
          .catch((err) => {
            setError(err.message || "Authentication failed. Please try again.");
          });
      })
      .catch((err) => {
        setError("Failed to validate state. Please try signing in again.");
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
