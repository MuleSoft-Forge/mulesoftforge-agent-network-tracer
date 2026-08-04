// Install the packaged app locally and put a launcher on the Desktop.
//
// Run after `npm run electron:pack` (or use `npm run electron:install-local`).
//
// Why install to /Applications instead of launching from electron-out/: macOS
// LaunchServices will not launch an app bundle from an arbitrary project
// directory, so double-clicking the build output does nothing. Installed to
// /Applications it launches normally, and the Desktop gets a symlink to it.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PRODUCT = "Agent Network Tracer";
const BUNDLE = `${PRODUCT}.app`;

if (process.platform !== "darwin") {
  console.error("install-local.mjs is macOS-only. On Windows run `npm run electron:dist` for the NSIS installer.");
  process.exit(1);
}

const projectDir = path.resolve(import.meta.dirname, "..");
const arch = process.arch === "arm64" ? "mac-arm64" : "mac";
const source = path.join(projectDir, "electron-out", arch, BUNDLE);

if (!fs.existsSync(source)) {
  console.error(`Not found: ${source}\nRun "npm run electron:pack" first.`);
  process.exit(1);
}

const target = path.join("/Applications", BUNDLE);
const desktopLink = path.join(os.homedir(), "Desktop", PRODUCT);

// Quit a running copy, else copying over it corrupts the running bundle.
try {
  execFileSync("pkill", ["-f", BUNDLE], { stdio: "ignore" });
} catch {
  // not running
}

console.log(`Installing ${BUNDLE} -> ${target}`);
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true, dereference: false, verbatimSymlinks: true });

// Strip quarantine/provenance so Gatekeeper does not block the unsigned build.
try {
  execFileSync("xattr", ["-cr", target], { stdio: "ignore" });
} catch {
  // nothing to clear
}

// Verify the seal survived the copy — a broken signature means it will not launch.
try {
  execFileSync("codesign", ["--verify", "--deep", target], { stdio: "pipe" });
  console.log("Signature verified.");
} catch (err) {
  console.error(
    `Signature invalid after install:\n${err.stderr?.toString().trim() ?? err.message}\n` +
      `The app may refuse to launch from Finder.`
  );
  process.exit(1);
}

// Desktop launcher: a symlink shows the real app icon and always tracks the
// installed copy (an alias file would need Finder scripting to create).
fs.rmSync(desktopLink, { recursive: true, force: true });
fs.symlinkSync(target, desktopLink);

console.log(`Desktop launcher: ${desktopLink}`);
console.log(`Done. Double-click "${PRODUCT}" on your Desktop to start.`);
