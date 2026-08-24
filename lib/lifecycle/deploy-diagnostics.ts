/**
 * Post-publish / post-deploy error diagnosis.
 *
 * After a lifecycle job finishes, the Anypoint CLI output often buries the real
 * cause under a stack of generic "component aborted" cascade errors. This module
 * scans that output for *known* failure signatures and turns each into a plain
 * explanation plus concrete fixes, so the UI can surface a solution instead of a
 * wall of red text.
 *
 * Dependency-light on purpose: no `@/` alias imports, no React, no Node APIs, so
 * both the browser (RemoteLifecyclePanel) and the lifecycle worker process can
 * import it and stay in agreement about what an error means.
 *
 * ── Adding a new known error ─────────────────────────────────────────────────
 * Append one `KnownDeployIssue` to `KNOWN_DEPLOY_ISSUES` below. A rule matches on
 * generic Anypoint platform signals (error codes, platform message strings, HTTP
 * status) — never on a specific broker, tenant, or asset id, so it stays correct
 * for every project. Mark downstream symptoms with `cascade: true` so they are
 * suppressed whenever a root-cause rule also matches.
 */

/** Lifecycle steps a diagnosis can be attributed to. Mirrors `CliCommand`. */
export type DiagnosisCommand = "build" | "publish" | "deploy" | "unpublish" | "undeploy";

export type DiagnosisSeverity = "error" | "warning" | "info";

export interface DiagnosisFix {
  title: string;
  detail: string;
}

export interface DeployDiagnosis {
  /** Stable identifier for the matched issue, e.g. "target-changed". */
  id: string;
  title: string;
  severity: DiagnosisSeverity;
  /** Single-line gist, safe to drop into a log line. */
  summary: string;
  /** Fuller plain-language explanation of the real root cause. */
  explanation: string;
  /** Ordered, concrete remediation steps. */
  fixes: DiagnosisFix[];
  /** Anypoint error codes that contributed to the match, when relevant. */
  errorCodes: number[];
  /**
   * True when this is a downstream symptom (e.g. "dependent task failed") rather
   * than the actionable root cause. Suppressed when a root-cause rule matches.
   */
  cascade: boolean;
}

export interface DeployDiagnosisInput {
  /** The step that failed. `null`/`build` yields no deploy-time diagnosis. */
  command: DiagnosisCommand | null;
  /** Full CLI output (stdout + stderr + meta). ANSI may be present. */
  output: string;
  /** Parsed final JSON payload from the CLI, if any. */
  resultJson?: unknown;
  /** Anypoint org id, for messages that reference it. */
  orgId?: string | null;
}

interface DiagnosisFacts {
  command: DiagnosisCommand | null;
  orgId: string | null;
  /** Combined, ANSI-stripped text (flattened JSON + raw output). */
  text: string;
  errorCodes: Set<number>;
  /** Extracted `{ code, message }` pairs from CLI error envelopes. */
  errors: Array<{ code: number | null; message: string }>;
  isForbidden: boolean;
}

interface KnownDeployIssue {
  id: string;
  /** Lower number surfaces first. */
  priority: number;
  detect(facts: DiagnosisFacts): DeployDiagnosis | null;
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

function flattenText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(flattenText).join("\n");
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).map(flattenText).join("\n");
  }
  return "";
}

function collectErrorCodes(resultJson: unknown, text: string): Set<number> {
  const codes = new Set<number>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (typeof record.errorCode === "number") codes.add(record.errorCode);
    for (const value of Object.values(record)) walk(value);
  };
  walk(resultJson);

  for (const match of text.matchAll(/"errorCode"\s*:\s*(\d+)/g)) {
    const parsed = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(parsed)) codes.add(parsed);
  }
  return codes;
}

/** Pull `{ errorCode, errorMessage }` and `{ message }` pairs out of the text. */
function collectErrors(text: string): Array<{ code: number | null; message: string }> {
  const errors: Array<{ code: number | null; message: string }> = [];
  const seen = new Set<string>();

  const push = (code: number | null, message: string) => {
    const trimmed = message.trim();
    if (!trimmed) return;
    const key = `${code ?? ""}:${trimmed}`;
    if (seen.has(key)) return;
    seen.add(key);
    errors.push({ code, message: trimmed });
  };

  // { "errorCode": N, "errorMessage": "..." } envelopes.
  for (const match of text.matchAll(
    /"errorCode"\s*:\s*(\d+)[\s\S]{0,80}?"errorMessage"\s*:\s*"((?:\\.|[^"\\])*)"/g
  )) {
    push(Number.parseInt(match[1] ?? "", 10), decodeJsonString(match[2] ?? ""));
  }
  // Bare "message": "..." (the nested cause Anypoint returns for 400s).
  for (const match of text.matchAll(/"message"\s*:\s*"((?:\\.|[^"\\])*)"/g)) {
    push(null, decodeJsonString(match[1] ?? ""));
  }
  return errors;
}

function decodeJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw.replace(/\\"/g, '"');
  }
}

/**
 * Drop echoed `$ anypoint-cli-v4 ...` command lines before pattern-matching.
 * They reflect flags *we* chose to pass (e.g. `--hard-delete`), not anything
 * the CLI said back — a bare substring match against them misattributes the
 * flag name itself as an error signal.
 */
function stripCommandEchoes(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("$ "))
    .join("\n");
}

function buildFacts(input: DeployDiagnosisInput): DiagnosisFacts {
  const text = stripAnsi(stripCommandEchoes(`${flattenText(input.resultJson)}\n${input.output}`));
  return {
    command: input.command,
    orgId: input.orgId?.trim() || null,
    text,
    errorCodes: collectErrorCodes(input.resultJson, text),
    errors: collectErrors(text),
    isForbidden: /\b403\b/.test(text) && /forbidden/i.test(text),
  };
}

const orgSuffix = (orgId: string | null) => (orgId ? ` in org ${orgId}` : "");
const refreshHint =
  'Check your role grants and OAuth scopes, then use "Refresh Anypoint permissions" from the header menu.';

/**
 * The known-error catalog. Order here does not matter — results are sorted by
 * `priority`. Keep each rule small and match only on platform-generic signals.
 */
const KNOWN_DEPLOY_ISSUES: KnownDeployIssue[] = [
  {
    // The headline case: cascading 3025 "component aborted" errors whose real
    // root cause is a 400 on the deployment PATCH — the target was changed after
    // the app's first successful deploy (e.g. deployed to one gateway/space, now
    // pointed at another). Anypoint locks the target after the initial deploy.
    id: "target-changed-after-initial-deploy",
    priority: 10,
    detect(facts) {
      if (facts.command !== "deploy") return null;
      if (!/target cannot be changed after the initial deployment/i.test(facts.text)) {
        return null;
      }
      return {
        id: "target-changed-after-initial-deploy",
        title: "Deployment target can't be changed after the first deploy",
        severity: "error",
        summary:
          "This network was first deployed to a different target; Anypoint locks the target after the initial deploy.",
        explanation:
          "The stack of \u201Ccomponent … was aborted\u201D / errorCode 3025 lines are follow-on symptoms. The real cause is the final 400 Bad Request on the deployment update: \u201CTarget cannot be changed after the initial deployment.\u201D This network was already deployed once, and this deploy is trying to send it to a different target (a different gateway, target space, region, or runtime). Anypoint only lets you choose the target on the first deploy and rejects any later attempt to move it in place.",
        fixes: [
          {
            title: "Deploy back to the original target",
            detail:
              "Set the deploy options (gateway / target space / environment) back to the target this network was first deployed to, then redeploy. In-place updates keep the original target.",
          },
          {
            title: "Or replace the deployment to move it",
            detail:
              "If you genuinely need a new target, delete the existing deployment in Anypoint Runtime Manager first, then run a fresh deploy against the new target. A new deployment can pick any target; an update cannot.",
          },
        ],
        errorCodes: dedupeCodes([...facts.errorCodes]).filter((c) => c === 3007 || c === 3025),
        cascade: false,
      };
    },
  },
  {
    // The deploy reaches Runtime Manager, but the app never becomes healthy
    // because the broker can't reach a connection it depends on (an MCP server
    // or other endpoint). RM keeps it pending, so the CLI eventually times out.
    // The unreachable connection — not the timeout — is the real cause; this
    // signature is usually found in the app's own RM log, which the worker pulls
    // in after a failed deploy.
    id: "broker-unreachable-connections",
    priority: 12,
    detect(facts) {
      if (facts.command !== "deploy") return null;
      const unreachable = /unreachable connections/i.test(facts.text);
      const failedValidation = /failed connection validation/i.test(facts.text);
      if (!unreachable && !failedValidation) return null;

      const httpStatus = facts.text.match(/returned HTTP\s+(\d{3})/i)?.[1] ?? null;
      const httpNote = httpStatus
        ? ` One or more connections came back with HTTP ${httpStatus}${
            httpStatus === "404" ? " — nothing is served at that address" : ""
          }.`
        : "";

      return {
        id: "broker-unreachable-connections",
        title: "The deployed broker can't reach its connections",
        severity: "error",
        summary:
          "Runtime Manager rejected the broker because one or more of its connections were unreachable, so it never became healthy.",
        explanation:
          "The deploy reached Runtime Manager, but the broker failed connection validation: at least one connection it depends on (an MCP server or other endpoint) could not be reached at its configured address." +
          httpNote +
          " Because the broker never passes validation, Runtime Manager keeps the deployment pending and the CLI eventually times out — the timeout is the symptom, the unreachable connection is the cause.",
        fixes: [
          {
            title: "Deploy the connection's target first",
            detail:
              "The endpoint the broker connects to (e.g. the MCP server) must already be deployed and running before the broker can validate against it. Deploy or start that target, confirm it responds, then redeploy the broker.",
          },
          {
            title: "Check the connection URL and gateway",
            detail:
              "Verify each connection's host, port, and path, and that they point at where the target actually runs. An HTTP 404 means nothing answers at that path; a refused or timed-out connection means nothing is listening there.",
          },
          {
            title: "Confirm the broker and its targets share a network",
            detail:
              "A broker can only reach targets on the same gateway / target space. If a target lives on a different gateway, its internal URL won't resolve — put them on the same one or use a reachable address.",
          },
        ],
        errorCodes: [],
        cascade: false,
      };
    },
  },
  {
    id: "permission-denied",
    priority: 20,
    detect(facts) {
      if (!facts.isForbidden) return null;
      if (facts.command === null || facts.command === "build") return null;
      const suffix = orgSuffix(facts.orgId);
      const perAction: Record<Exclude<DiagnosisCommand, "build">, string> = {
        publish: `Your account lacks permission to publish assets to Exchange${suffix}.`,
        deploy: `Your account lacks permission to deploy${suffix}.`,
        unpublish: `Your account lacks permission to delete Exchange assets${suffix}.`,
        undeploy: `Your account lacks permission to remove deployments${suffix}.`,
      };
      const summary = perAction[facts.command];
      return {
        id: "permission-denied",
        title: "403 Forbidden — missing Anypoint permission",
        severity: "error",
        summary,
        explanation: `Anypoint rejected the ${facts.command} with 403 Forbidden. ${summary} This is a role or OAuth scope gap on your account, not a problem with the project.`,
        fixes: [
          {
            title: "Grant the missing permission",
            detail: `Ask an org admin to grant the role for this action${suffix || ""}, then refresh your session. ${refreshHint}`,
          },
        ],
        errorCodes: [],
        cascade: false,
      };
    },
  },
  {
    // oclif cannot serialize its own Plugin graph, so a rejected flag surfaces in
    // --json mode as this TypeError rather than the real parse error.
    id: "cli-flag-rejected",
    priority: 20,
    detect(facts) {
      if (facts.command === null || facts.command === "build") return null;
      if (!/circular structure to JSON/i.test(facts.text)) return null;
      return {
        id: "cli-flag-rejected",
        title: "The Anypoint CLI rejected a command argument",
        severity: "error",
        summary: `The CLI rejected the ${facts.command} arguments and couldn't report why.`,
        explanation: `The Anypoint CLI failed while serializing its own error, which almost always means a flag the ${facts.command} command does not accept was passed. The raw output points nowhere near the real cause.`,
        fixes: [
          {
            title: "Check the command flags",
            detail: `Compare the command line above against \u201Cagent-network project ${facts.command} --help\u201D and remove any flag that command does not support.`,
          },
        ],
        errorCodes: [],
        cascade: false,
      };
    },
  },
  {
    id: "deploy-needs-local-build",
    priority: 30,
    detect(facts) {
      if (facts.command !== "deploy" || !facts.errorCodes.has(3046)) return null;
      return {
        id: "deploy-needs-local-build",
        title: "Deploy needs a local build first",
        severity: "error",
        summary: "Deploy requires build artifacts that aren't present in this workspace.",
        explanation:
          "The deploy step needs the artifacts produced by a build in the same workspace, and none were found (errorCode 3046).",
        fixes: [
          {
            title: "Build, then deploy",
            detail:
              'Run Build (or use "Publish & Deploy", which chains the build in) so the deploy has artifacts to ship.',
          },
        ],
        errorCodes: [3046],
        cascade: false,
      };
    },
  },
  {
    // errorCode 2007 is thrown client-side by the plugin's own preflight guard
    // (guardAgainstDeployedResources) before it ever calls Exchange, so it is
    // an exact, unambiguous signal — prefer it over text sniffing. The legacy
    // regex matched an older "active API instances" wording the CLI no longer
    // emits; keep it only as a fallback for output without a JSON payload.
    id: "unpublish-active-instances",
    priority: 30,
    detect(facts) {
      if (facts.command !== "unpublish") return null;
      const hasCode = facts.errorCodes.has(2007);
      const hasNewText = /deployed resource\(s\) still reference|still reference these assets/i.test(
        facts.text
      );
      const hasLegacyText = /active.*(api|instance)/i.test(facts.text);
      if (!hasCode && !hasNewText && !hasLegacyText) return null;
      // The 2007 message already lists every blocking resource by kind/name —
      // surface it verbatim instead of a generic sentence.
      const detail = facts.errors.find((e) => e.code === 2007)?.message;
      return {
        id: "unpublish-active-instances",
        title: "Deployed resources still reference this asset",
        severity: "error",
        summary: "Unpublish was refused because deployed resources still reference this asset (errorCode 2007).",
        explanation:
          detail ??
          "You can't remove an Exchange asset while deployed resources (connections, API Manager instances, or AMC deployments) still reference it.",
        fixes: [
          {
            title: "Undeploy first",
            detail: "Run 'agent-network project undeploy', then retry the unpublish.",
          },
        ],
        errorCodes: hasCode ? [2007] : [],
        cascade: false,
      };
    },
  },
  {
    id: "unpublish-hard-delete-window",
    priority: 30,
    detect(facts) {
      if (facts.command !== "unpublish") return null;
      // errorCode 2007 (deployed resources still reference the asset) and the
      // "could not verify deployed resources" guard failure both legitimately
      // mention "hard-delete" in their own message text — neither is the
      // 7-day-window rejection this rule is for.
      if (facts.errorCodes.has(2007)) return null;
      if (/verify deployed resources before a hard.?delete/i.test(facts.text)) return null;
      if (!/hard.?delete/i.test(facts.text)) return null;
      return {
        id: "unpublish-hard-delete-window",
        title: "Hard delete is no longer allowed",
        severity: "error",
        summary: "Anypoint refused the hard delete.",
        explanation:
          "A hard delete is only permitted for roughly the first seven days after an asset is created, and an organization can disable it entirely.",
        fixes: [
          {
            title: "Use a soft delete",
            detail:
              "A soft delete still removes the asset, but its version can never be republished. Uncheck hard delete and try again.",
          },
        ],
        errorCodes: [],
        cascade: false,
      };
    },
  },
  {
    id: "teardown-target-not-found",
    priority: 30,
    detect(facts) {
      if (facts.command !== "unpublish" && facts.command !== "undeploy") return null;
      if (!/not found|no .*(asset|deployment).*found/i.test(facts.text)) return null;
      return {
        id: "teardown-target-not-found",
        title: "Nothing matched the target",
        severity: "error",
        summary: "No matching asset or deployment was found to remove.",
        explanation:
          "The teardown could not find anything at the coordinates it was given, so there was nothing to remove.",
        fixes: [
          {
            title: "Check the coordinates",
            detail:
              "Verify the GAV (groupId:assetId:version), the business group, and — for undeploy — the environment.",
          },
        ],
        errorCodes: [],
        cascade: false,
      };
    },
  },
  {
    id: "publish-asset-failure",
    priority: 40,
    detect(facts) {
      if (facts.command !== "publish" || !facts.errorCodes.has(2003)) return null;
      return {
        id: "publish-asset-failure",
        title: "Asset publication failed",
        severity: "error",
        summary: "Publish failed while publishing an asset to Exchange (errorCode 2003).",
        explanation:
          "The publish step failed during asset publication (errorCode 2003). The specific asset and reason are in the first publish error above.",
        fixes: [
          {
            title: "Inspect the first publish error",
            detail:
              "Check the earliest publish error for the asset name and reason (a version conflict or a permission gap is common).",
          },
        ],
        errorCodes: [2003],
        cascade: false,
      };
    },
  },
  {
    // Fallback when a deploy is terminated at its time limit and nothing more
    // specific matched. Marked cascade so any real root cause (e.g. an
    // unreachable connection surfaced from the RM log) suppresses it — but on
    // its own it still explains that a timeout means "never went healthy",
    // not "retry a flaky request".
    id: "deploy-timed-out",
    priority: 85,
    detect(facts) {
      if (facts.command !== "deploy") return null;
      if (
        !/timed out after[\s\S]*terminating the cli/i.test(facts.text) &&
        !/deploy step timed out/i.test(facts.text)
      ) {
        return null;
      }
      return {
        id: "deploy-timed-out",
        title: "Deploy timed out waiting for the app to become healthy",
        severity: "error",
        summary:
          "The deploy ran past its time limit — usually the app deployed but never reached a healthy state in Runtime Manager.",
        explanation:
          "The CLI was terminated after hitting its deploy time limit. In practice a deploy rarely hangs at random — the app is created but fails to start or fails health / connection validation, so Runtime Manager keeps it pending until the CLI gives up. The real cause is in the app's own Runtime Manager log.",
        fixes: [
          {
            title: "Read the Runtime Manager log",
            detail:
              "Check the Runtime Manager log lines pulled in above (or open Runtime Manager → your app → Logs) for the actual startup / validation error — that is the cause, not the timeout.",
          },
          {
            title: "Fix the cause, then redeploy",
            detail:
              "Address whatever the log reports — an unreachable connection, a bad property, a failed dependency — then run the deploy again.",
          },
          {
            title: "Only raise the timeout if the run is genuinely slow",
            detail:
              "If the app really needs longer to come up, raise LIFECYCLE_DEPLOY_TIMEOUT_MS. Raising it won't help when the app is failing validation.",
          },
        ],
        errorCodes: [],
        cascade: true,
      };
    },
  },
  {
    // Downstream symptom: suppressed when a root-cause rule (e.g. target-changed)
    // also matches, otherwise surfaced as a "look above" pointer.
    id: "dependent-task-failed",
    priority: 80,
    detect(facts) {
      if (facts.command !== "deploy" || !facts.errorCodes.has(3025)) return null;
      return {
        id: "dependent-task-failed",
        title: "A dependent deployment task failed",
        severity: "error",
        summary: "Deploy stopped because a dependent deployment task failed (errorCode 3025).",
        explanation:
          "errorCode 3025 means one deployment stage was aborted because another stage it depends on failed. It is a cascade error — the actionable cause is the first error reported before it.",
        fixes: [
          {
            title: "Find the first error",
            detail: "Scroll to the earliest error in the output; that is the root cause of the 3025 aborts.",
          },
        ],
        errorCodes: [3025],
        cascade: true,
      };
    },
  },
  {
    id: "wrapped-stage-failure",
    priority: 90,
    detect(facts) {
      if (facts.command === null || facts.command === "build") return null;
      if (!facts.errorCodes.has(9001)) return null;
      return {
        id: "wrapped-stage-failure",
        title: "Wrapped stage failure",
        severity: "error",
        summary: "The CLI returned a wrapped stage failure (errorCode 9001).",
        explanation:
          "errorCode 9001 is a generic wrapper the CLI puts around a stage failure. The real cause is one of the preceding stage errors.",
        fixes: [
          {
            title: "Review the preceding errors",
            detail: "Look at the stage errors above the 9001 wrapper for the actionable root cause.",
          },
        ],
        errorCodes: [9001],
        cascade: true,
      };
    },
  },
];

function dedupeCodes(codes: number[]): number[] {
  return [...new Set(codes)].sort((a, b) => a - b);
}

const SEVERITY_RANK: Record<DiagnosisSeverity, number> = { error: 0, warning: 1, info: 2 };

/**
 * Scan finished-job output and return recognized diagnoses, most actionable
 * first. Cascade (downstream) diagnoses are dropped whenever a root-cause
 * diagnosis is present, mirroring how the CLI's own errors cascade.
 */
export function diagnoseDeployOutput(input: DeployDiagnosisInput): DeployDiagnosis[] {
  const facts = buildFacts(input);

  const matches: DeployDiagnosis[] = [];
  const seen = new Set<string>();
  for (const issue of KNOWN_DEPLOY_ISSUES) {
    const diagnosis = issue.detect(facts);
    if (!diagnosis || seen.has(diagnosis.id)) continue;
    seen.add(diagnosis.id);
    matches.push({ ...diagnosis, errorCodes: dedupeCodes(diagnosis.errorCodes) });
  }

  const hasRootCause = matches.some((m) => !m.cascade);
  const kept = hasRootCause ? matches.filter((m) => !m.cascade) : matches;

  const priorityById = new Map(KNOWN_DEPLOY_ISSUES.map((issue) => [issue.id, issue.priority]));
  return kept.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return (priorityById.get(a.id) ?? 999) - (priorityById.get(b.id) ?? 999);
  });
}

/** The single most actionable diagnosis, or null when nothing was recognized. */
export function primaryDiagnosis(diagnoses: DeployDiagnosis[]): DeployDiagnosis | null {
  return diagnoses[0] ?? null;
}
