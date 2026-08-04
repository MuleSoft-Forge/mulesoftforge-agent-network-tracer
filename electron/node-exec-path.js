// Resolve a Node-capable executable that does not create a macOS Dock icon.
//
// Spawning `process.execPath` (the main .app binary) with ELECTRON_RUN_AS_NODE
// makes macOS treat the child as a GUI app and show a generic "exec" icon in
// the Dock. The Electron Helper binary has LSUIElement=true in its Info.plist,
// so it runs headless. Next.js worker forks inherit the same execPath.
//
// We derive the Helper from the main binary path instead of app.isPackaged /
// app.getName(), which are not always set when this runs in packaged builds.

const fs = require("node:fs");
const path = require("node:path");

function getNodeExecutablePath() {
  if (process.platform !== "darwin") return process.execPath;

  const macOsDir = path.dirname(process.execPath);
  const contentsDir = path.basename(macOsDir) === "MacOS" ? path.dirname(macOsDir) : null;
  if (!contentsDir || path.basename(contentsDir) !== "Contents") {
    return process.execPath;
  }

  const appBinary = path.basename(process.execPath);
  const helperName = `${appBinary} Helper`;
  const helperPath = path.join(
    contentsDir,
    "Frameworks",
    `${helperName}.app`,
    "Contents/MacOS",
    helperName,
  );

  if (fs.existsSync(helperPath)) return helperPath;
  return process.execPath;
}

module.exports = { getNodeExecutablePath };
