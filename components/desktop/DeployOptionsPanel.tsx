"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { GatewaySelect, pickGatewayDefault } from "@/components/desktop/GatewaySelect";
import { TargetSpaceSelect } from "@/components/desktop/TargetSpaceSelect";
import {
  DEFAULT_EGRESS_GW,
  DEFAULT_INGRESS_GW,
  DEFAULT_PRIVATE_SPACE,
  deployOptionsReady,
  getPropertyValue,
  setPropertyValue,
  type DeployOptions,
  type ProjectDeployVariable,
} from "@/lib/desktop/deploy-options";
import type { DeploymentTarget } from "@/lib/mulesoft/deployment-targets";
import {
  filterDeploymentTargets,
  pickDeploymentTargetDefault,
} from "@/lib/mulesoft/deployment-targets";
import type { ManagedGateway } from "@/lib/mulesoft/managed-gateways";
import {
  readAnypointUiContext,
  UI_CONTEXT_CHANGED_EVENT,
} from "@/lib/anypoint/ui-context";
import { fetchProfile, readCachedProfile } from "@/lib/anypoint/profile-client";
import type { Profile } from "@/lib/parsers";

interface AnypointEnvironment {
  id: string;
  name: string;
  type: string;
}

interface DeployOptionsPanelProps {
  options: DeployOptions;
  variables: ProjectDeployVariable[];
  onChange: (next: DeployOptions) => void;
  disabled?: boolean;
}

interface VariableGroup {
  key: string;
  title: string;
  variables: ProjectDeployVariable[];
}

/** The CLI takes `--organization` by name, but the left menu selects by id. */
function orgNameForId(profile: Profile | null, orgId: string): string | null {
  if (!profile) return null;
  if (profile.organization?.id === orgId) return profile.organization.name;
  return profile.memberOfOrganizations?.find((org) => org.id === orgId)?.name ?? null;
}

export default function DeployOptionsPanel({
  options,
  variables,
  onChange,
  disabled = false,
}: DeployOptionsPanelProps) {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [contextEnvId, setContextEnvId] = useState<string | null>(null);
  const [environments, setEnvironments] = useState<AnypointEnvironment[]>([]);
  const [gateways, setGateways] = useState<ManagedGateway[]>([]);
  const [gatewaysLoading, setGatewaysLoading] = useState(false);
  const [gatewaysError, setGatewaysError] = useState<string | null>(null);
  const [targets, setTargets] = useState<DeploymentTarget[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetsError, setTargetsError] = useState<string | null>(null);
  const [revealedSecrets, setRevealedSecrets] = useState<Set<string>>(() => new Set());
  const [variablesCollapsed, setVariablesCollapsed] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());

  const selectedEnvironment = environments.find((env) => env.id === contextEnvId) ?? null;
  const selectedEnvId = selectedEnvironment?.id ?? null;
  const filteredTargets = filterDeploymentTargets(targets, options.targetKind);
  const selectedGateway =
    options.targetKind === "shared"
      ? (gateways.find((g) => g.name === options.gateway) ?? null)
      : null;
  const patch = useCallback(
    (partial: Partial<DeployOptions>) => onChange({ ...options, ...partial }),
    [onChange, options]
  );

  useEffect(() => {
    const syncFromUiContext = () => {
      const ctx = readAnypointUiContext();
      setOrgId(ctx?.orgId ?? null);
      setContextEnvId(ctx?.envId ?? null);
    };

    syncFromUiContext();
    window.addEventListener("focus", syncFromUiContext);
    window.addEventListener("storage", syncFromUiContext);
    window.addEventListener(UI_CONTEXT_CHANGED_EVENT, syncFromUiContext);
    return () => {
      window.removeEventListener("focus", syncFromUiContext);
      window.removeEventListener("storage", syncFromUiContext);
      window.removeEventListener(UI_CONTEXT_CHANGED_EVENT, syncFromUiContext);
    };
  }, []);

  useEffect(() => {
    if (!orgId) {
      setOrgName(null);
      return;
    }
    let cancelled = false;
    const cached = orgNameForId(readCachedProfile(), orgId);
    if (cached) setOrgName(cached);
    fetchProfile()
      .then((profile) => {
        if (!cancelled) setOrgName(orgNameForId(profile, orgId));
      })
      .catch(() => {
        if (!cancelled) setOrgName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  // The CLI resolves environment and gateway names inside --organization, so the
  // selected business group has to travel with the deploy options. Only the id
  // is sent; the server maps it to the org name the CLI expects.
  useEffect(() => {
    const next = orgId ?? "";
    if ((options.organizationId ?? "") === next) return;
    patch({ organizationId: next });
  }, [options.organizationId, orgId, patch]);

  useEffect(() => {
    if (!orgId) {
      setEnvironments([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/accounts/organizations/${encodeURIComponent(orgId)}/environments`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: { data?: AnypointEnvironment[] }) => {
        if (cancelled) return;
        const list = Array.isArray(body.data)
          ? body.data.filter((e) => e.type !== "design")
          : [];
        setEnvironments(list);
        const selectedByContext =
          (contextEnvId && list.find((env) => env.id === contextEnvId)) ?? null;
        if (selectedByContext && selectedByContext.name !== options.environment) {
          patch({
            environment: selectedByContext.name,
            targetSpace: "",
            gateway: "",
            ingressGw: "",
            egressGw: "",
          });
        }
      })
      .catch(() => {
        if (!cancelled) setEnvironments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [contextEnvId, options.environment, orgId, patch]);

  useEffect(() => {
    if (!orgId || !selectedEnvId) {
      setGateways([]);
      setGatewaysError(null);
      return;
    }

    let cancelled = false;
    setGatewaysLoading(true);
    setGatewaysError(null);
    fetch(
      `/api/accounts/organizations/${encodeURIComponent(orgId)}/environments/${encodeURIComponent(selectedEnvId)}/gateways`
    )
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: { data?: ManagedGateway[]; error?: string }) => {
        if (cancelled) return;
        const list = Array.isArray(body.data) ? body.data : [];
        setGateways(list);
        if (body.error) setGatewaysError(body.error);
      })
      .catch(() => {
        if (!cancelled) {
          setGateways([]);
          setGatewaysError("Could not load gateways for this environment.");
        }
      })
      .finally(() => {
        if (!cancelled) setGatewaysLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orgId, selectedEnvId]);

  useEffect(() => {
    if (!orgId || !selectedEnvId) {
      setTargets([]);
      setTargetsError(null);
      return;
    }

    let cancelled = false;
    setTargetsLoading(true);
    setTargetsError(null);
    fetch(
      `/api/accounts/organizations/${encodeURIComponent(orgId)}/environments/${encodeURIComponent(selectedEnvId)}/deployment-targets`
    )
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: { data?: DeploymentTarget[]; error?: string }) => {
        if (cancelled) return;
        const list = Array.isArray(body.data) ? body.data : [];
        setTargets(list);
        if (body.error) setTargetsError(body.error);
      })
      .catch(() => {
        if (!cancelled) {
          setTargets([]);
          setTargetsError("Could not load deployment targets for this environment.");
        }
      })
      .finally(() => {
        if (!cancelled) setTargetsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orgId, selectedEnvId]);

  useEffect(() => {
    if (options.targetKind !== "private" || targets.length === 0) return;
    const nextTarget = pickDeploymentTargetDefault(
      options.targetSpace,
      targets,
      options.targetKind
    );
    if (nextTarget && nextTarget !== (options.targetSpace ?? "")) {
      onChange({ ...options, targetSpace: nextTarget });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets, options.targetKind]);

  useEffect(() => {
    if (gateways.length === 0) return;

    if (options.targetKind === "shared") {
      const nextGateway = pickGatewayDefault(options.gateway, gateways);
      if (nextGateway && nextGateway !== (options.gateway ?? "")) {
        onChange({ ...options, gateway: nextGateway });
      }
      return;
    }

    const nextIngress = pickGatewayDefault(options.ingressGw, gateways);
    const nextEgress = pickGatewayDefault(options.egressGw, gateways);
    if (
      (nextIngress && nextIngress !== (options.ingressGw ?? "")) ||
      (nextEgress && nextEgress !== (options.egressGw ?? ""))
    ) {
      onChange({
        ...options,
        ingressGw: nextIngress || options.ingressGw,
        egressGw: nextEgress || options.egressGw,
      });
    }
    // Auto-select when the gateway list loads or the environment changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateways, options.targetKind]);

  useEffect(() => {
    if (orgId || contextEnvId || !options.environment) return;
    patch({
      environment: "",
      targetSpace: "",
      gateway: "",
      ingressGw: "",
      egressGw: "",
    });
  }, [contextEnvId, options.environment, orgId, patch]);

  const setProperty = useCallback(
    (name: string, value: string) => {
      patch({ properties: setPropertyValue(options.properties, name, value) });
    },
    [options.properties, patch]
  );

  const readiness = deployOptionsReady(options, variables);
  const groupedVariables = useMemo<VariableGroup[]>(() => {
    const byGroup = new Map<string, ProjectDeployVariable[]>();
    for (const variable of variables) {
      const firstDot = variable.key.indexOf(".");
      const groupKey = firstDot > 0 ? variable.key.slice(0, firstDot) : "misc";
      const list = byGroup.get(groupKey) ?? [];
      list.push(variable);
      byGroup.set(groupKey, list);
    }
    return [...byGroup.entries()]
      .map(([key, list]) => ({
        key,
        title: key === "misc" ? "Other variables" : key,
        variables: [...list].sort((a, b) => a.key.localeCompare(b.key)),
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [variables]);

  useEffect(() => {
    setCollapsedGroups((prev) => {
      if (prev.size === 0) return prev;
      const valid = new Set(groupedVariables.map((g) => g.key));
      const next = new Set<string>();
      for (const key of prev) {
        if (valid.has(key)) next.add(key);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [groupedVariables]);

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <p className="text-sm font-semibold text-gray-900">Business Group &amp; Environment</p>
        <div className="rounded-anypoint border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800">
          <div>
            <span className="font-medium">Business Group:</span>{" "}
            <span>
              {orgName
                ? orgName
                : orgId
                  ? `Resolving ${orgId}...`
                  : "Not selected in left menu"}
            </span>
          </div>
          <div>
            <span className="font-medium">Environment:</span>{" "}
            <span>
              {selectedEnvironment
                ? `${selectedEnvironment.name} (${selectedEnvironment.type})`
                : contextEnvId
                  ? `Resolving ${contextEnvId}...`
                  : "Not selected in left menu"}
            </span>
          </div>
        </div>
        <p className="text-xs text-gray-400">
          Context is inherited from the left menu in Builder/Tracer and passed to the CLI as{" "}
          <span className="font-mono">--organization</span> and{" "}
          <span className="font-mono">--environment</span>. Gateways below are looked up inside this
          business group, so both must match.
          {!orgId && " Select business group and environment in the left menu first."}
        </p>
      </section>

      {/* Deployment target */}
      <section className="space-y-3">
        <p className="text-sm font-semibold text-gray-900">
          Deployment target <span className="text-red-500">*</span>
        </p>
        <div className="flex flex-wrap gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
            <input
              type="radio"
              name="deploy-target-kind"
              checked={options.targetKind === "shared"}
              onChange={() => {
                const gateway = pickGatewayDefault(options.gateway, gateways);
                patch({
                  targetKind: "shared",
                  gateway,
                  targetSpace: "",
                });
              }}
              disabled={disabled}
              className="text-primary focus:ring-primary"
            />
            Shared space
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
            <input
              type="radio"
              name="deploy-target-kind"
              checked={options.targetKind === "private"}
              onChange={() =>
                patch({
                  targetKind: "private",
                  targetSpace: pickDeploymentTargetDefault(
                    options.targetSpace,
                    targets,
                    "private"
                  ),
                  ingressGw: pickGatewayDefault(options.ingressGw, gateways) || DEFAULT_INGRESS_GW,
                  egressGw: pickGatewayDefault(options.egressGw, gateways) || DEFAULT_EGRESS_GW,
                })
              }
              disabled={disabled}
              className="text-primary focus:ring-primary"
            />
            Private space
          </label>
        </div>

        {options.targetKind === "shared" ? (
          <div className="space-y-3">
            <GatewaySelect
              id="deploy-gateway"
              label="Gateway"
              value={options.gateway ?? ""}
              gateways={gateways}
              loading={gatewaysLoading}
              disabled={disabled || !options.environment}
              placeholder="omni-ai-gateway"
              onChange={(gateway) => patch({ gateway })}
            />
            {gatewaysError ? (
              <p className="text-xs text-amber-600">{gatewaysError}</p>
            ) : options.gateway ? (
              <p className="text-xs text-gray-500">
                {selectedGateway?.derivedTargetSpace ? (
                  <>
                    Using shared space{" "}
                    <span className="font-mono">{selectedGateway.derivedTargetSpace}</span> derived
                    from gateway <span className="font-mono">{options.gateway}</span>.
                  </>
                ) : gatewaysLoading ? (
                  <>Resolving shared space for gateway {options.gateway}…</>
                ) : (
                  <>
                    Deploy passes <span className="font-mono">--gateway {options.gateway}</span>;
                    the CLI derives the shared space at runtime (as in Anypoint Code Builder).
                  </>
                )}
              </p>
            ) : (
              <p className="text-xs text-gray-400">
                Select a gateway — shared space is derived automatically at deploy time.
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <TargetSpaceSelect
                id="deploy-target-space-private"
                label="Private space"
                value={options.targetSpace ?? ""}
                targets={filteredTargets}
                loading={targetsLoading}
                disabled={disabled || !options.environment}
                placeholder={DEFAULT_PRIVATE_SPACE}
                onChange={(targetSpace) => patch({ targetSpace })}
              />
            </div>
            <GatewaySelect
              id="deploy-ingress-gw"
              label="Ingress gateway"
              value={options.ingressGw ?? ""}
              gateways={gateways}
              loading={gatewaysLoading}
              disabled={disabled || !options.environment}
              placeholder={DEFAULT_INGRESS_GW}
              onChange={(ingressGw) => patch({ ingressGw })}
            />
            <GatewaySelect
              id="deploy-egress-gw"
              label="Egress gateway"
              value={options.egressGw ?? ""}
              gateways={gateways}
              loading={gatewaysLoading}
              disabled={disabled || !options.environment}
              placeholder={DEFAULT_EGRESS_GW}
              onChange={(egressGw) => patch({ egressGw })}
            />
            {targetsError || gatewaysError ? (
              <p className="text-xs text-amber-600 sm:col-span-2">
                {targetsError ?? gatewaysError}
              </p>
            ) : null}
          </div>
        )}
      </section>

      {/* Variables */}
      <section className="space-y-3">
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
          <button
            type="button"
            onClick={() => setVariablesCollapsed((prev) => !prev)}
            className="flex w-full items-center justify-between bg-gray-100 px-3 py-2 text-left hover:bg-gray-200"
            aria-expanded={!variablesCollapsed}
          >
            <div>
              <p className="text-sm font-semibold text-gray-900">Variables</p>
              <p className="mt-1 text-xs text-gray-500">
                From <span className="font-mono">exchange.json</span> metadata.variables — passed as{" "}
                <span className="font-mono">--property name:value</span>.
              </p>
            </div>
            <span className="font-mono text-xs text-gray-500">
              {variablesCollapsed ? "[+]" : "[-]"}
            </span>
          </button>

          {!variablesCollapsed ? (
            <div className="p-3">
              {variables.length === 0 ? (
                <p className="text-xs text-gray-400">No deploy variables in this project.</p>
              ) : (
                <ul className="space-y-3">
                  {groupedVariables.map((group) => {
                    const collapsed = collapsedGroups.has(group.key);
                    const missingCount = group.variables.reduce((count, variable) => {
                      const value = getPropertyValue(options.properties, variable.key).trim();
                      return value ? count : count + 1;
                    }, 0);

                    return (
                      <li key={group.key} className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                        <button
                          type="button"
                          onClick={() =>
                            setCollapsedGroups((prev) => {
                              const next = new Set(prev);
                              if (next.has(group.key)) next.delete(group.key);
                              else next.add(group.key);
                              return next;
                            })
                          }
                          className="flex w-full items-center justify-between bg-gray-100 px-3 py-2 text-left hover:bg-gray-200"
                          aria-expanded={!collapsed}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-bold text-gray-900">{group.title}</span>
                            <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[11px] font-semibold text-white">
                              {group.variables.length}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            {missingCount > 0 ? (
                              <span className="rounded bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">
                                {missingCount} missing
                              </span>
                            ) : (
                              <span className="rounded bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">
                                complete
                              </span>
                            )}
                            <span className="font-mono text-gray-500">{collapsed ? "[+]" : "[-]"}</span>
                          </div>
                        </button>

                        {!collapsed ? (
                          <ul className="space-y-3 p-3">
                            {group.variables.map((variable) => {
                              const value = getPropertyValue(options.properties, variable.key);
                              const showSecret = revealedSecrets.has(variable.key);
                              const inputId = `deploy-var-${variable.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
                              return (
                                <li key={variable.key}>
                                  <label htmlFor={inputId} className="block text-xs font-medium text-gray-800">
                                    <span className="font-mono">{variable.key}</span>
                                    {variable.description ? (
                                      <span className="ml-1 font-normal text-gray-500">({variable.description})</span>
                                    ) : null}
                                    {variable.secret ? <span className="ml-1 text-red-500">*</span> : null}
                                  </label>
                                  <div className="relative mt-1.5">
                                    <input
                                      id={inputId}
                                      type={variable.secret && !showSecret ? "password" : "text"}
                                      value={value}
                                      onChange={(e) => setProperty(variable.key, e.target.value)}
                                      disabled={disabled}
                                      placeholder={variable.secret ? "Enter secret value" : variable.default || ""}
                                      className="w-full rounded-anypoint border border-gray-300 bg-white px-3 py-2 pr-9 font-mono text-sm text-gray-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-60"
                                    />
                                    {variable.secret ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setRevealedSecrets((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(variable.key)) next.delete(variable.key);
                                            else next.add(variable.key);
                                            return next;
                                          })
                                        }
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                        aria-label={showSecret ? "Hide value" : "Show value"}
                                      >
                                        {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                      </button>
                                    ) : null}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      </section>

      {!readiness.ok ? (
        <p className="text-xs text-amber-600">{readiness.reason}</p>
      ) : (
        <p className="text-xs text-green-600">Deploy options are complete.</p>
      )}
    </div>
  );
}

export { deployOptionsReady };
