"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Eye, EyeOff, Save } from "lucide-react";
import {
  CREDENTIALS_STORAGE_PREFIX,
  type SavedCredentials,
} from "@/lib/llmProxy/types";
import { devLog, devWarn } from "@/lib/api-logger";

interface CredentialsPanelProps {
  instanceId: string;
  /** Prefill values derived from the detail API. */
  defaultPublicEndpoint: string | null;
  defaultBasePath: string | null;
  onChange: (creds: SavedCredentials | null) => void;
}

function storageKey(instanceId: string): string {
  return `${CREDENTIALS_STORAGE_PREFIX}${instanceId}`;
}

function loadSaved(instanceId: string): SavedCredentials | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(instanceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedCredentials>;
    if (
      typeof parsed.publicEndpoint === "string" &&
      typeof parsed.basePath === "string" &&
      typeof parsed.clientId === "string" &&
      typeof parsed.clientSecret === "string"
    ) {
      return parsed as SavedCredentials;
    }
    return null;
  } catch {
    return null;
  }
}

export default function CredentialsPanel({
  instanceId,
  defaultPublicEndpoint,
  defaultBasePath,
  onChange,
}: CredentialsPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [publicEndpoint, setPublicEndpoint] = useState("");
  const [basePath, setBasePath] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  /**
   * Tracks whether the user manually edited `publicEndpoint` / `basePath`
   * since the last instance change. When false, the component is free to
   * overwrite these fields if authoritative defaults arrive asynchronously.
   */
  const userEditedEndpointsRef = useRef({ publicEndpoint: false, basePath: false });
  const lastInstanceIdRef = useRef<string>("");

  useEffect(() => {
    const instanceChanged = lastInstanceIdRef.current !== instanceId;
    lastInstanceIdRef.current = instanceId;
    const saved = loadSaved(instanceId);
    devLog(
      `[LLM-PROXY-CLIENT CredentialsPanel] effect instanceId=${instanceId} ` +
        `instanceChanged=${instanceChanged} ` +
        `defaultPublicEndpoint=${defaultPublicEndpoint} defaultBasePath=${defaultBasePath} ` +
        `saved=${saved ? JSON.stringify({ publicEndpoint: saved.publicEndpoint, basePath: saved.basePath, clientId: saved.clientId, hasSecret: Boolean(saved.clientSecret) }) : "null"}`
    );

    if (instanceChanged) {
      userEditedEndpointsRef.current = { publicEndpoint: false, basePath: false };
    }

    if (saved) {
      // Heal stale saved publicEndpoint/basePath whenever we now have an
      // authoritative default that differs. `clientId`/`clientSecret` are
      // always preserved verbatim.
      const healedPublicEndpoint =
        !userEditedEndpointsRef.current.publicEndpoint &&
        defaultPublicEndpoint &&
        defaultPublicEndpoint !== saved.publicEndpoint
          ? defaultPublicEndpoint
          : saved.publicEndpoint;
      const healedBasePath =
        !userEditedEndpointsRef.current.basePath &&
        defaultBasePath &&
        defaultBasePath !== saved.basePath
          ? defaultBasePath
          : saved.basePath;
      const didHeal =
        healedPublicEndpoint !== saved.publicEndpoint ||
        healedBasePath !== saved.basePath;
      devLog(
        `[LLM-PROXY-CLIENT CredentialsPanel] saved-branch instanceId=${instanceId} ` +
          `savedPublicEndpoint=${saved.publicEndpoint} -> ${healedPublicEndpoint} ` +
          `savedBasePath=${saved.basePath} -> ${healedBasePath} didHeal=${didHeal} ` +
          `userEdited=${JSON.stringify(userEditedEndpointsRef.current)}`
      );
      setPublicEndpoint(healedPublicEndpoint);
      setBasePath(healedBasePath);
      if (instanceChanged) {
        setClientId(saved.clientId);
        setClientSecret(saved.clientSecret);
        setExpanded(false);
      }
      const healed: SavedCredentials = {
        publicEndpoint: healedPublicEndpoint,
        basePath: healedBasePath,
        clientId: saved.clientId,
        clientSecret: saved.clientSecret,
      };
      if (didHeal) {
        try {
          localStorage.setItem(storageKey(instanceId), JSON.stringify(healed));
          devLog(
            `[LLM-PROXY-CLIENT CredentialsPanel] persisted healed creds for instanceId=${instanceId}`
          );
        } catch (err) {
          devWarn("[LLM-PROXY-CLIENT CredentialsPanel] failed to persist healed creds", err);
        }
      }
      emitIfValid(healed);
    } else {
      // No saved creds. On instance change, wipe everything. Whenever we
      // later receive authoritative defaults (detail fetch resolves), and
      // the user hasn't manually edited, seed the endpoint/basePath.
      if (instanceChanged) {
        devLog(
          `[LLM-PROXY-CLIENT CredentialsPanel] no saved creds, instance changed -> reset ` +
            `instanceId=${instanceId} publicEndpoint=${defaultPublicEndpoint ?? ""} basePath=${defaultBasePath ?? ""}`
        );
        setPublicEndpoint(defaultPublicEndpoint ?? "");
        setBasePath(defaultBasePath ?? "");
        setClientId("");
        setClientSecret("");
        setExpanded(true);
        onChange(null);
      } else {
        if (
          !userEditedEndpointsRef.current.publicEndpoint &&
          defaultPublicEndpoint &&
          defaultPublicEndpoint !== publicEndpoint
        ) {
          devLog(
            `[LLM-PROXY-CLIENT CredentialsPanel] re-seed publicEndpoint from late default ` +
              `${publicEndpoint} -> ${defaultPublicEndpoint}`
          );
          setPublicEndpoint(defaultPublicEndpoint);
        }
        if (
          !userEditedEndpointsRef.current.basePath &&
          defaultBasePath &&
          defaultBasePath !== basePath
        ) {
          devLog(
            `[LLM-PROXY-CLIENT CredentialsPanel] re-seed basePath from late default ` +
              `${basePath} -> ${defaultBasePath}`
          );
          setBasePath(defaultBasePath);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, defaultPublicEndpoint, defaultBasePath]);

  function emitIfValid(creds: SavedCredentials): void {
    if (creds.publicEndpoint && creds.basePath && creds.clientId && creds.clientSecret) {
      onChange(creds);
    } else {
      onChange(null);
    }
  }

  function handleSave(): void {
    const creds: SavedCredentials = { publicEndpoint, basePath, clientId, clientSecret };
    devLog(
      `[LLM-PROXY-CLIENT CredentialsPanel] handleSave instanceId=${instanceId} ` +
        `publicEndpoint=${publicEndpoint} basePath=${basePath} ` +
        `hasClientId=${Boolean(clientId)} hasClientSecret=${Boolean(clientSecret)}`
    );
    try {
      localStorage.setItem(storageKey(instanceId), JSON.stringify(creds));
    } catch {
      /* ignore storage errors */
    }
    setSavedAt(Date.now());
    setExpanded(false);
    emitIfValid(creds);
  }

  const isComplete = Boolean(publicEndpoint && basePath && clientId && clientSecret);

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">Credentials</span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              isComplete ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
            }`}
          >
            {isComplete ? "Ready" : "Required"}
          </span>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-gray-500 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>
      {expanded && (
        <div className="space-y-3 border-t border-gray-100 px-3 py-3">
          <p className="text-[11px] text-gray-500">
            The LLM Proxy requires a <span className="font-mono">client_id</span> and
            <span className="font-mono"> client_secret</span> from an approved Exchange
            contract. Copy both from the consumer application in Anypoint (Access
            Management → Connected Apps, or the application&apos;s Exchange page).
            Values are saved to your browser&apos;s localStorage only.
          </p>
          <div>
            <label className="block text-xs font-medium text-gray-700">Public endpoint</label>
            <input
              type="text"
              value={publicEndpoint}
              onChange={(e) => {
                userEditedEndpointsRef.current.publicEndpoint = true;
                setPublicEndpoint(e.target.value);
              }}
              placeholder="https://gateway.example.com"
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700">Base path</label>
            <input
              type="text"
              value={basePath}
              onChange={(e) => {
                userEditedEndpointsRef.current.basePath = true;
                setBasePath(e.target.value);
              }}
              placeholder="/llm-proxy"
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700">Client ID</label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              autoComplete="off"
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700">Client secret</label>
            <div className="mt-1 flex gap-1">
              <input
                type={showSecret ? "text" : "password"}
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                autoComplete="off"
                className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                className="rounded-md border border-gray-300 px-2 text-gray-500 hover:bg-gray-50"
                aria-label={showSecret ? "Hide secret" : "Show secret"}
              >
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            {savedAt && (
              <span className="text-[11px] text-gray-500">Saved to localStorage</span>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={!isComplete}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-3 w-3" />
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
