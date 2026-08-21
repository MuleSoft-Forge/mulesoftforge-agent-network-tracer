/**
 * The only CLI command shapes this service may invoke. Ported from
 * electron/cli/runner.js. The client picks a command KEY only; it never
 * supplies argv.
 *
 * `json` and `debug` record which optional flags each command actually accepts,
 * because the agent-fabric plugin does not implement them uniformly. Passing an
 * unsupported flag is not a soft failure: oclif rejects it, and in --json mode
 * its own error reporter then dies with "Converting circular structure to JSON"
 * while serializing the Plugin graph, so the real cause never reaches the log.
 * Verified against `agent-network project <cmd> --help` in plugin 1.2.11.
 */

import type { CliCommand } from "../contracts";

interface CommandSpec {
  argv: readonly string[];
  json: boolean;
  debug: boolean;
}

export const COMMANDS: Record<CliCommand, CommandSpec> = {
  build: { argv: ["agent-network", "project", "build"], json: false, debug: true },
  publish: { argv: ["agent-network", "project", "publish"], json: true, debug: true },
  deploy: { argv: ["agent-network", "project", "deploy"], json: true, debug: false },
  // Hidden from `agent-network project --help` in plugin 1.2.11, but fully
  // implemented. Both prompt for confirmation unless --force is passed, which
  // removal-argv always does — the worker has no stdin to answer a prompt with.
  unpublish: { argv: ["agent-network", "project", "unpublish"], json: true, debug: false },
  undeploy: { argv: ["agent-network", "project", "undeploy"], json: true, debug: false },
};

/** Descriptor file every Agent Network project must contain. */
export const DESCRIPTOR_FILE = "exchange.json";
