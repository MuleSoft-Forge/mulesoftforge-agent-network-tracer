"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { Bug, ChevronDown, LogOut, RefreshCw } from "lucide-react";
import BetaBadge from "@/components/ui/BetaBadge";
import { REGIONS } from "@/lib/regions";
import type { RegionOption } from "@/lib/regions";
import type { Profile } from "@/lib/parsers";
import { fetchProfile, readCachedProfile, writeCachedProfile } from "@/lib/anypoint/profile-client";

type NavItem = {
  href: string;
  label: string;
  requiresAuth: boolean;
  beta?: boolean;
  /** Operator-only surface; the page and its APIs re-check this server-side. */
  requiresOps?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/agent-network", label: "Tracer", requiresAuth: true, beta: true },
  { href: "/builder", label: "Builder", requiresAuth: true, beta: true },
  { href: "/lifecycle", label: "Build & Publish", requiresAuth: true, beta: true },
  { href: "/ops", label: "Ops", requiresAuth: true, requiresOps: true },
  { href: "/help", label: "Help", requiresAuth: false },
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
    const cached = readCachedProfile();
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
          // Shared accessor: joins the request BusinessGroupSelector is already
          // making rather than issuing a second one.
          return fetchProfile();
        }
        writeCachedProfile(null);
        return null;
      })
      .then((p) => {
        if (p) {
          setProfile(p);
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
  const opsAccess = profile?.opsAccess === true;

  async function handleSignOut(): Promise<void> {
    const res = await fetch("/api/auth/sign-out", {
      method: "POST",
      credentials: "include",
    });
    if (res.ok) {
      writeCachedProfile(null);
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
                alt="Agent Network Studio"
                width={64}
                height={64}
                className="h-16 w-16 shrink-0 group-hover:scale-110 transition-transform duration-200"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-purple-500/20 rounded-full blur opacity-0 group-hover:opacity-100 transition-opacity duration-200"></div>
            </div>
            <span className="bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent group-hover:from-primary group-hover:to-purple-600 transition-all duration-200">Agent Network Studio</span>
          </Link>
          <nav className="flex items-center gap-1 ml-8" aria-label="App menu">
            {NAV_ITEMS.filter(
              (item: NavItem) =>
                (!item.requiresAuth || authenticated) && (!item.requiresOps || opsAccess)
            ).map((item: NavItem) => {
              const { href, label, beta } = item;
              // Help spans several sub-pages; keep its tab lit across all of them.
              const isActive = href === "/help" ? pathname.startsWith("/help") : pathname === href;
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
                  <span className="inline-flex items-center gap-1.5">
                    {label}
                    {beta ? <BetaBadge /> : null}
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {authenticated && (
            <>
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(new CustomEvent("agent-network:open-bug-report"))
                }
                title="Report a bug"
                aria-label="Report a bug"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-red-200/70 bg-red-50/70 text-red-600 shadow-sm transition-colors hover:bg-red-100 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
              >
                <Bug className="h-4 w-4" aria-hidden="true" />
              </button>
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
    </>
  );
}
