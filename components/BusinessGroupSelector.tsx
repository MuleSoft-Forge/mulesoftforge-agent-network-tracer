"use client";

import { useEffect, useRef, useState } from "react";

export const BUSINESS_GROUP_ALL = "ALL";
export const BUSINESS_GROUP_NONE = "";

const PROFILE_CACHE_KEY = "agent-network-profile";

interface Organization {
  id: string;
  name: string;
  parentName?: string | null;
  parentId?: string | null;
  isRoot?: boolean;
  isMaster?: boolean;
  [key: string]: unknown;
}

interface Profile {
  organization?: Organization;
  memberOfOrganizations?: Organization[];
  [key: string]: unknown;
}

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

interface BusinessGroupSelectorProps {
  initialOrgId?: string;
  onSelect?: (value: string, allOrgIds: string[], rootOrgId: string) => void;
  disabled?: boolean;
}

export default function BusinessGroupSelector({
  initialOrgId,
  onSelect,
  disabled = false,
}: BusinessGroupSelectorProps) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [selectedValue, setSelectedValue] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const hasRestoredRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const cached = getCachedProfile();
    if (cached) {
      setProfile(cached);
      setLoading(false);
    }

    let cancelled = false;
    fetch("/api/auth/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then((p: Profile | null) => {
        if (cancelled) return;
        setProfile(p);
        setCachedProfile(p ?? null);
        if (!initialOrgId) setSelectedValue(BUSINESS_GROUP_NONE);
      })
      .catch(() => {
        if (!cancelled) setSelectedValue(BUSINESS_GROUP_NONE);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialOrgId]);

  useEffect(() => {
    if (!profile || !initialOrgId || hasRestoredRef.current) return;
    const byId = new Map<string, Organization>();
    if (profile.organization) byId.set(profile.organization.id, profile.organization);
    if (profile.memberOfOrganizations) {
      for (const org of profile.memberOfOrganizations) {
        if (!byId.has(org.id)) byId.set(org.id, org);
      }
    }
    if (!byId.has(initialOrgId)) return;
    hasRestoredRef.current = true;
    setSelectedValue(initialOrgId);
    const allOrgIds = getOrderedOrgIds(profile);
    const rootOrgId = profile.organization?.id ?? allOrgIds[0] ?? "";
    onSelectRef.current?.(initialOrgId, allOrgIds, rootOrgId);
  }, [profile, initialOrgId]);

  if (loading) {
    return (
      <div className="space-y-2">
        <label className="text-sm font-semibold text-gray-900">Business Group</label>
        <div className="h-9 w-full animate-pulse rounded-anypoint border border-gray-200 bg-gray-100" />
      </div>
    );
  }

  if (!profile) {
    return null;
  }

  const byId = new Map<string, Organization>();
  if (profile.organization) {
    byId.set(profile.organization.id, profile.organization);
  }
  if (profile.memberOfOrganizations) {
    for (const org of profile.memberOfOrganizations) {
      if (!byId.has(org.id)) {
        byId.set(org.id, org);
      }
    }
  }
  const businessGroups = Array.from(byId.values());
  businessGroups.sort((a: Organization, b: Organization) => {
    if (a.isRoot && !b.isRoot) return -1;
    if (!a.isRoot && b.isRoot) return 1;
    return a.name.localeCompare(b.name);
  });

  const allOrgIds = getOrderedOrgIds(profile);
  const rootOrgId = profile.organization?.id ?? allOrgIds[0] ?? "";

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setSelectedValue(value);
    // Only call onSelect if a business group is actually selected (not placeholder)
    if (value !== BUSINESS_GROUP_NONE) {
      onSelect?.(value, allOrgIds, rootOrgId);
    } else {
      // Clear selection when placeholder is selected
      onSelect?.(BUSINESS_GROUP_NONE, [], "");
    }
  };

  return (
    <div className="space-y-2">
      <label htmlFor="business-group" className="text-sm font-semibold text-gray-900">
        Business Group
      </label>
      <select
        id="business-group"
        value={selectedValue}
        onChange={handleChange}
        disabled={disabled}
        className="w-full rounded-anypoint border border-gray-300 bg-white px-3 py-2 pr-8 text-sm text-gray-900 transition-all duration-150 ease-[cubic-bezier(0.46,0.03,0.52,0.96)] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-70"
      >
        <option value={BUSINESS_GROUP_NONE}>Select Business Group</option>
        {/* MVP: hide "All" so user must choose a Business Group and then a broker */}
        {businessGroups.map((org: Organization) => (
          <option key={org.id} value={org.id}>
            {org.name}
            {org.isRoot ? " (Root)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

function getOrderedOrgIds(profile: Profile): string[] {
  const byId = new Map<string, string>();
  if (profile.organization?.id) {
    byId.set(profile.organization.id, profile.organization.id);
  }
  if (profile.memberOfOrganizations) {
    for (const org of profile.memberOfOrganizations) {
      if (!byId.has(org.id)) {
        byId.set(org.id, org.id);
      }
    }
  }
  const list = Array.from(byId.values());
  const root = profile.organization?.id;
  if (root && list.length > 0) {
    const rest = list.filter((id: string) => id !== root);
    return [root, ...rest];
  }
  return list;
}
