"use client";

import { useRouter } from "next/navigation";
import { PRIVACY_ACCEPT_STORAGE_KEY } from "@/components/PrivacyPolicyModal";

function setStoredPrivacyAccepted(value: boolean): void {
  try {
    if (value) {
      localStorage.setItem(PRIVACY_ACCEPT_STORAGE_KEY, "1");
    } else {
      localStorage.removeItem(PRIVACY_ACCEPT_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

export default function PrivacyAcceptButton() {
  const router = useRouter();

  function handleAccept(): void {
    setStoredPrivacyAccepted(true);
    router.push("/");
  }

  return (
    <button
      type="button"
      onClick={handleAccept}
      className="w-full max-w-sm rounded-anypoint-button bg-primary px-6 py-3 text-center text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-600 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
      aria-label="I have read and accept this Privacy Policy"
    >
      I have read and accept this Privacy Policy
    </button>
  );
}
