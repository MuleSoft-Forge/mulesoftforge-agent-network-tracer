"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { ChevronDown, LogOut, FileJson, RefreshCw } from "lucide-react";
import { REGIONS } from "@/lib/regions";
import type { RegionOption } from "@/lib/regions";
import { parseProfile, type Profile } from "@/lib/parsers";

const PROFILE_CACHE_KEY = "agent-network-profile";

function getCachedProfile(): Profile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    return parseProfile(raw);
  } catch {
    return null;
  }
}

function setCachedProfile(profile: Profile | null): void {
  try {
    if (profile) {
      sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
    } else {
      sessionStorage.removeItem(PROFILE_CACHE_KEY);
    }
  } catch {
    /* ignore */
  }
}

type NavItem = {
  href: string;
  label: string;
  requiresAuth: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/agent-network", label: "Agent Network", requiresAuth: true },
  { href: "/compose", label: "Composer", requiresAuth: true },
  { href: "/about", label: "About", requiresAuth: false },
  { href: "/privacy", label: "Privacy", requiresAuth: false },
];

export default function Header() {
  const pathname = usePathname();
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [regionLabel, setRegionLabel] = useState<string | null>(null);
  /** Control plane origin from session (OAuth region); used for Anypoint link next to region label. */
  const [anypointBaseUrl, setAnypointBaseUrl] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(event: MouseEvent): void {
      if (menuRef.current != null && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [menuOpen]);

  useEffect(() => {
    // Check cache first
    const cached = getCachedProfile();
    if (cached) {
      setProfile(cached);
    }

    // Fetch session to get authentication status and region
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data: { authenticated?: boolean; baseUrl?: string }) => {
        setAuthenticated(!!data.authenticated);

        if (data.baseUrl) {
          const origin = data.baseUrl.replace(/\/$/, "");
          setAnypointBaseUrl(origin);
          const region = REGIONS.find((r: RegionOption) => r.baseUrl === origin);
          setRegionLabel(region?.label ?? "Anypoint");
        } else if (data.authenticated) {
          setAnypointBaseUrl(REGIONS[0].baseUrl.replace(/\/$/, ""));
          setRegionLabel("US (Global)");
        } else {
          setAnypointBaseUrl(null);
          setRegionLabel(null);
        }
        
        if (data.authenticated) {
          // Only fetch profile if not cached
          if (!cached) {
            return fetch("/api/auth/profile").then((r) => (r.ok ? r.json() : null));
          }
          return cached;
        }
        setCachedProfile(null);
        return null;
      })
      .then((p) => {
        if (p) {
          setProfile(p);
          setCachedProfile(p); // Update cache
        } else if (!cached) {
          setProfile(null);
        }
      })
      .catch(() => {
        setAuthenticated(false);
        setProfile(null);
        setRegionLabel(null);
        setAnypointBaseUrl(null);
      });
  }, [pathname]); // Run when pathname changes to refresh on navigation

  const displayName =
    [profile?.firstName, profile?.lastName].filter((v: string | undefined): v is string => Boolean(v)).join(" ") ||
    profile?.username ||
    "—";
  const secondaryLine = (profile?.email || profile?.organization?.name) ?? "";
  const initial = (displayName !== "—" ? displayName[0] : "?").toUpperCase();

  async function handleSignOut(): Promise<void> {
    const res = await fetch("/api/auth/sign-out", {
      method: "POST",
      credentials: "include",
    });
    if (res.ok) {
      setCachedProfile(null);
      setProfile(null);
      setAuthenticated(false);
      window.location.href = "/";
    }
  }

  return (
    <>
    <header className="relative z-50 border-b border-gray-200/50 bg-white/80 backdrop-blur-md shadow-sm">
      {/* Subtle gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent opacity-50"></div>
      <div className="relative flex h-14 w-full items-center justify-between gap-4 pl-4 pr-4">
        <div className="flex min-w-0 items-center gap-6">
          <Link
            href={authenticated ? "/agent-network" : "/"}
            className="flex shrink-0 items-center gap-2 text-lg font-semibold text-gray-900 hover:text-primary transition-colors duration-200 group"
          >
            <div className="relative">
              <Image
                src="/ant-logo-landing.png"
                alt=""
                width={64}
                height={64}
                className="h-16 w-16 shrink-0 group-hover:scale-110 transition-transform duration-200"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-purple-500/20 rounded-full blur opacity-0 group-hover:opacity-100 transition-opacity duration-200"></div>
            </div>
            <span className="bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent group-hover:from-primary group-hover:to-purple-600 transition-all duration-200">Agent Network Tracer</span>
          </Link>
          <nav className="flex items-center gap-1 ml-8" aria-label="App menu">
            {NAV_ITEMS.filter((item: NavItem) => !item.requiresAuth || authenticated).map((item: NavItem) => {
              const { href, label } = item;
              const isActive = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={`shrink-0 rounded-anypoint px-3 py-2 text-sm font-medium transition-all duration-200 ease-[cubic-bezier(0.46,0.03,0.52,0.96)] focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
                    isActive
                      ? "bg-gradient-to-r from-primary/15 to-purple-500/15 text-primary shadow-sm"
                      : "text-gray-600 hover:bg-gradient-to-r hover:from-gray-50 hover:to-gray-100/50 hover:text-gray-900"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {authenticated && (
            <>
              {regionLabel && anypointBaseUrl && (
                <>
                  <a
                    href={anypointBaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-gray-500 hover:text-primary hover:underline"
                    title="Open Anypoint Platform (your sign-in region)"
                  >
                    {regionLabel}
                  </a>
                  <div className="h-4 w-px bg-gray-200" aria-hidden="true" />
                </>
              )}
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((prev) => !prev)}
                  className="flex min-w-0 items-center gap-3 rounded-lg border border-gray-200/50 bg-white/60 backdrop-blur-sm px-3 py-2 shadow-sm hover:bg-white/80 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-all duration-200"
                  aria-expanded={menuOpen}
                  aria-haspopup="true"
                  aria-label="Account menu"
                >
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-purple-600 text-sm font-semibold text-white shadow-md hover:shadow-lg transition-shadow duration-200"
                    aria-hidden="true"
                  >
                    {initial}
                  </div>
                  <div className="min-w-0 text-left">
                    <p className="truncate text-sm font-semibold text-gray-900">{displayName}</p>
                    {secondaryLine ? (
                      <p className="truncate text-xs text-gray-500" title={secondaryLine}>
                        {secondaryLine}
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400">Connected</p>
                    )}
                  </div>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${menuOpen ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  />
                </button>
                {menuOpen && (
                  <div
                    className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-gray-200 bg-white shadow-xl"
                    role="menu"
                  >
                    {profile?.organization && (
                      <div className="space-y-1 border-b border-gray-100 px-3 py-3 text-xs">
                        <p className="text-gray-500">
                          <span className="font-medium text-gray-700">Org:</span>{" "}
                          <span className="text-gray-900">{profile.organization.name}</span>
                        </p>
                        <p className="text-gray-500">
                          <span className="font-medium text-gray-700">Org ID:</span>{" "}
                          <span className="font-mono text-gray-900">{profile.organization.id}</span>
                        </p>
                      </div>
                    )}
                    <div className="py-1">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          setRawOpen(true);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                      >
                        <FileJson className="h-4 w-4 shrink-0" aria-hidden="true" />
                        View raw
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          window.location.assign("/auth/sign-in?reauth=1");
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                      >
                        <RefreshCw className="h-4 w-4 shrink-0" aria-hidden="true" />
                        Refresh Anypoint permissions
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => void handleSignOut()}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                      >
                        <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
                        Sign out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
    {rawOpen && profile && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        onClick={() => setRawOpen(false)}
        aria-modal="true"
        role="dialog"
        aria-label="Raw profile"
      >
        <div
          className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-2">
            <span className="text-sm font-medium text-gray-700">Raw profile</span>
            <button
              type="button"
              onClick={() => setRawOpen(false)}
              className="rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              Close
            </button>
          </div>
          <pre className="max-h-[70vh] overflow-auto p-4 text-xs text-gray-800">
            <code>{JSON.stringify(profile, null, 2)}</code>
          </pre>
        </div>
      </div>
    )}
    </>
  );
}
