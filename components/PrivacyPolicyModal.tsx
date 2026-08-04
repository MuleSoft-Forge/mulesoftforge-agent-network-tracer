"use client";

import { useEffect, useCallback } from "react";
import PrivacyPolicyContent from "@/components/PrivacyPolicyContent";

export const PRIVACY_ACCEPT_STORAGE_KEY = "agent-network-disclaimer";

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

type PrivacyPolicyModalProps = {
  open: boolean;
  onClose: () => void;
  onAccept: () => void;
};

export default function PrivacyPolicyModal({
  open,
  onClose,
  onAccept,
}: PrivacyPolicyModalProps) {
  const handleAccept = useCallback(() => {
    setStoredPrivacyAccepted(true);
    onAccept();
  }, [onAccept]);

  useEffect(() => {
    if (!open) return;
    function handleEscape(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-modal-title"
    >
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden="true"
        onClick={onClose}
      />
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-gray-200 bg-white shadow-xl">
        <div className="shrink-0 border-b border-gray-200 px-6 py-4">
          <h1 id="privacy-modal-title" className="text-xl font-semibold text-gray-900">
            Agent Network Tracer: Privacy Policy & Terms of Use
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Effective Date: February 17, 2026
            <br />
            Status: Personal Project (Unofficial)
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <PrivacyPolicyContent />
        </div>
        <div className="shrink-0 border-t border-gray-200 px-6 py-4">
          <button
            type="button"
            onClick={handleAccept}
            className="w-full rounded-anypoint-button bg-primary px-6 py-3 text-center text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-600 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            aria-label="I have read and accept this Privacy Policy"
          >
            I have read and accept this Privacy Policy
          </button>
          <button
            type="button"
            onClick={onClose}
            className="mt-3 w-full text-center text-sm text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded py-1"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
