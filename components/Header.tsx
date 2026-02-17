"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { ChevronDown, LogOut } from "lucide-react";
import { REGIONS } from "@/lib/regions";
import type { RegionOption } from "@/lib/regions";

const PROFILE_CACHE_KEY = "agent-network-profile";

type Profile = {
  firstName?: string;
  lastName?: string;
  email?: string;
  username?: string;
  organization?: { name?: string; id?: string; [key: string]: unknown };
  [key: string]: unknown;
};

function getCachedProfile(): Profile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Profile;
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
  { href: "/about", label: "About", requiresAuth: false },
  { href: "/privacy", label: "Privacy", requiresAuth: false },
];

export default function Header() {
  const pathname = usePathname();
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [regionLabel, setRegionLabel] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
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
      .then((data) => {
        setAuthenticated(!!data.authenticated);
        
        // Determine region from baseUrl - set immediately
        if (data.baseUrl) {
          const region = REGIONS.find((r: RegionOption) => r.baseUrl === data.baseUrl);
          setRegionLabel(region?.label ?? null);
        } else if (data.authenticated) {
          // Fallback: if authenticated but no baseUrl, assume US (default)
          setRegionLabel("US (Global)");
        } else {
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
    <header className="border-b border-gray-200 bg-white">
      <div className="flex h-14 w-full items-center justify-between gap-4 pl-4 pr-4">
        <div className="flex min-w-0 items-center gap-6">
          <Link
            href={authenticated ? "/agent-network" : "/"}
            className="flex shrink-0 items-center gap-2 text-lg font-semibold text-gray-900"
          >
            <Image
              src="/logo.svg"
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 shrink-0"
            />
            <span>Agent Network Tracer</span>
          </Link>
          <nav className="flex items-center gap-1 ml-8" aria-label="App menu">
            {NAV_ITEMS.filter((item: NavItem) => !item.requiresAuth || authenticated).map((item: NavItem) => {
              const { href, label } = item;
              const isActive = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={`shrink-0 rounded-anypoint px-3 py-2 text-sm font-medium transition-all duration-150 ease-[cubic-bezier(0.46,0.03,0.52,0.96)] focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
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
              {regionLabel && (
                <>
                  <span className="text-xs text-gray-500">{regionLabel}</span>
                  <div className="h-4 w-px bg-gray-200" aria-hidden="true" />
                </>
              )}
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((prev) => !prev)}
                  className="flex min-w-0 items-center gap-3 rounded-lg border border-gray-200 bg-gray-50/80 px-3 py-2 shadow-sm hover:bg-gray-100/80 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                  aria-expanded={menuOpen}
                  aria-haspopup="true"
                  aria-label="Account menu"
                >
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-white"
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
                    className="absolute right-0 top-full z-10 mt-1 min-w-[10rem] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                    role="menu"
                  >
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
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
