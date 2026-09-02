/**
 * Validate teardown options and append CLI flags for `unpublish` / `undeploy`.
 *
 * Same contract as deploy-argv: the client picks a command key and supplies
 * values, never raw argv, and every value is re-validated here before it can
 * reach the spawned process.
 *
 * Two rules are load-bearing rather than cosmetic:
 *   * `--force` is always appended. Both commands prompt for confirmation, and
 *     the runner spawns with stdio stdin "ignore" — without it the CLI would
 *     block on an unanswerable prompt until the step timeout killed it.
 *   * `--gav` and `--path` are mutually exclusive at the CLI level, so the
 *     caller passing a gav means the runner must not also pass a path.
 */

import { GAV_PATTERN, type RemovalCommand, type RemovalOptions, type RemovalTargetType } from "../contracts";

function assertEnvironment(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!s || s.length > 128 || /[\x00-\x1f]/.test(s)) {
    throw new Error("A valid environment name is required.");
  }
  return s;
}

/** Display names may contain spaces; spawn runs shell:false so argv is inert. */
function assertOrganization(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!s || s.length > 128 || /[\x00-\x1f]/.test(s)) {
    throw new Error("A valid organization (business group) name is required.");
  }
  return s;
}

function assertGav(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!GAV_PATTERN.test(s)) {
    throw new Error("GAV must look like groupId:assetId:version.");
  }
  return s;
}

export interface ValidatedRemoval {
  type: RemovalTargetType;
  organization: string;
  /** Always present for undeploy; optional safety check for unpublish. */
  environment?: string;
  gav?: string;
  hardDelete: boolean;
}

export function validateRemovalOptions(
  command: RemovalCommand,
  removal: RemovalOptions | undefined
): ValidatedRemoval {
  if (!removal || typeof removal !== "object") {
    throw new Error("Removal options are required.");
  }

  const out: ValidatedRemoval = {
    type: "agent-network",
    organization: assertOrganization(removal.organization),
    hardDelete: false,
  };

  out.type = removal.type ?? "agent-network";

  if (removal.gav !== undefined) {
    out.gav = assertGav(removal.gav);
  }

  switch (command) {
    case "undeploy":
      // The deployment lives in an environment; without it the CLI has nothing
      // to search, and with --gav the docs require one explicitly.
      out.environment = assertEnvironment(removal.environment);
      break;
    case "unpublish":
      // Optional here, but when present the CLI refuses to remove an asset that
      // still has active API instances — so pass it through whenever we have it.
      if (removal.environment !== undefined && String(removal.environment).trim()) {
        out.environment = assertEnvironment(removal.environment);
      }
      // Opt-in: Anypoint restricts hard deletes to a window after asset
      // creation, so defaulting to one would fail for most real assets.
      out.hardDelete = removal.hardDelete === true;
      break;
    default: {
      const _exhaustive: never = command;
      throw new Error(`Unhandled removal command: ${String(_exhaustive)}`);
    }
  }

  return out;
}

/**
 * Append validated teardown flags. `--path` is added by the runner for bundle
 * mode; this function owns everything else, including the gav that replaces it.
 */
export function appendRemovalArgv(
  argv: string[],
  command: RemovalCommand,
  removal: RemovalOptions | undefined
): void {
  const options = validateRemovalOptions(command, removal);

  argv.push("--organization", options.organization);
  if (options.environment) {
    argv.push("--environment", options.environment);
  }
  if (options.gav) {
    argv.push("--gav", options.gav);
  }
  if (options.hardDelete) {
    argv.push("--hard-delete");
  }
  argv.push("--force");
}
