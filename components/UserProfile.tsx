"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { debugError } from "@/lib/api-logger";

interface UserProfileData {
  firstName?: string;
  lastName?: string;
  email?: string;
  username?: string;
  organization?: {
    name?: string;
  };
}

export default function UserProfile() {
  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDropdown, setShowDropdown] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // Fetch user profile
    fetch("/api/auth/profile")
      .then((res) => {
        if (!res.ok) {
          if (res.status === 401) {
            // Not authenticated, redirect to sign-in
            router.push("/auth/sign-in");
            return null;
          }
          throw new Error(`Failed to fetch profile: ${res.status}`);
        }
        return res.json();
      })
      .then((data: UserProfileData) => {
        if (data) {
          setProfile(data);
        }
      })
      .catch((error) => {
        debugError("Error fetching profile:", error);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [router]);

  if (loading) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 animate-pulse rounded-full bg-gray-200" />
        <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
      </div>
    );
  }

  if (!profile) {
    return null;
  }

  const displayName =
    profile.firstName && profile.lastName
      ? `${profile.firstName} ${profile.lastName}`
      : profile.email || profile.username || "User";

  const initials =
    profile.firstName && profile.lastName
      ? `${profile.firstName[0]}${profile.lastName[0]}`.toUpperCase()
      : profile.email
        ? profile.email[0].toUpperCase()
        : "U";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-2 rounded-anypoint px-3 py-2 text-sm font-medium text-gray-700 transition-all duration-150 ease-[cubic-bezier(0.46,0.03,0.52,0.96)] hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
        aria-label="User menu"
        aria-expanded={showDropdown}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
          <span className="text-xs font-semibold">{initials}</span>
        </div>
        <span className="hidden sm:inline">{displayName}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${showDropdown ? "rotate-180" : ""}`} />
      </button>

      {showDropdown && (
        <>
          {/* Backdrop to close dropdown */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setShowDropdown(false)}
            aria-hidden="true"
          />

          {/* Dropdown menu */}
          <div className="absolute right-0 top-full z-20 mt-2 w-64 rounded-lg border border-gray-200 bg-white shadow-lg">
            <div className="p-4">
              <div className="mb-3 flex items-center gap-3 border-b border-gray-200 pb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <span className="text-sm font-semibold">{initials}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-900">{displayName}</p>
                  {(profile.email || profile.username) && (
                    <p className="truncate text-xs text-gray-500">
                      {profile.email || profile.username}
                    </p>
                  )}
                </div>
              </div>

              {profile.organization?.name && (
                <div className="mb-3 border-b border-gray-200 pb-3">
                  <p className="text-xs text-gray-500">Organization</p>
                  <p className="text-sm font-medium text-gray-900">{profile.organization.name}</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
