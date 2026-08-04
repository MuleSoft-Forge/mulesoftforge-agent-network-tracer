// electron-builder afterPack hook.
//
// electron-builder unconditionally strips `node_modules` from `extraResources`
// (a filter does not override it), but the Next standalone server cannot run
// without its pruned node_modules. So we copy that one directory in here, after
// packaging, straight into Resources/app-standalone/node_modules.

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

exports.default = async function afterPack(context) {
  const projectDir = context.packager.projectDir;
  const src = path.join(projectDir, "electron-dist", "app-standalone", "node_modules");

  if (!fs.existsSync(src)) {
    throw new Error(
      `afterPack: ${src} not found — run "npm run electron:assemble" before packaging.`
    );
  }

  // Resources dir differs per platform.
  const resourcesDir =
    context.electronPlatformName === "darwin"
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(context.appOutDir, "resources");

  const dest = path.join(resourcesDir, "app-standalone", "node_modules");

  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true, dereference: true });

  console.log(`  • afterPack: copied standalone node_modules -> ${path.relative(projectDir, dest)}`);

  // NOTE: the bundle is signed by electron-builder AFTER this hook (mac.identity
  // "-" = ad-hoc), so adding files to Resources here is safe — the seal is
  // computed over the final contents. Do NOT re-sign with `codesign --deep`:
  // it mis-signs Electron's helper apps and the app then dies at startup with
  // "task_name_for_pid: (os/kern) failure".
};
