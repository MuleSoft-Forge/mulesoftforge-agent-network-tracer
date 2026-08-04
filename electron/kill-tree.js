// Kill a process and all of its descendants.
//
// Replaces the `tree-kill` package. The main process must require NOTHING
// outside Electron's builtins: electron-builder bundles only production
// dependencies into app.asar, so a devDependency require here throws at load
// and the packaged app dies silently before app.whenReady() runs. Rather than
// promote a 40-line helper to a runtime dependency, we inline it.
//
// Why it matters: the Next server is a child process, and it in turn spawns
// workers. Killing only the direct child orphans them and leaves port 3000 held.

// Everything here is synchronous on purpose. killTree runs from shutdown(),
// which is called on `before-quit` and `process.on("exit")` — an async callback
// scheduled there never runs, so an async walk would return having killed
// nothing and leave the Next workers orphaned holding port 3000.

const { execFileSync, spawnSync } = require("node:child_process");

/** Collect a pid and all descendants, parents-first. */
function collectTree(rootPid) {
  const pids = [rootPid];
  const queue = [rootPid];

  while (queue.length > 0) {
    const pid = queue.shift();

    // `pgrep -P` lists direct children; recurse to get the whole tree.
    let stdout = "";
    try {
      stdout = execFileSync("pgrep", ["-P", String(pid)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      // pgrep exits non-zero when there are no children — nothing to add.
      continue;
    }

    for (const line of stdout.split("\n")) {
      const child = Number.parseInt(line.trim(), 10);
      if (Number.isInteger(child) && !pids.includes(child)) {
        pids.push(child);
        queue.push(child);
      }
    }
  }

  return pids;
}

/**
 * Terminate `pid` and its descendants. Best effort — never throws.
 * @param {number} pid
 * @param {string} [signal] POSIX signal, default SIGTERM.
 */
function killTree(pid, signal = "SIGTERM") {
  if (!Number.isInteger(pid) || pid <= 0) return;

  if (process.platform === "win32") {
    // taskkill walks the tree itself (/T) and force-kills (/F).
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }

  // Children before parents, so a dying parent can't re-reap out of order.
  for (const target of collectTree(pid).reverse()) {
    try {
      process.kill(target, signal);
    } catch {
      // already gone
    }
  }
}

module.exports = { killTree };
