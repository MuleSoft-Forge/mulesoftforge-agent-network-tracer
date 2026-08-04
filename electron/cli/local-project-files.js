// Read / write Agent Network project source files on disk (Electron main process).

const fs = require("node:fs");
const path = require("node:path");

const DESCRIPTOR_FILE = "exchange.json";
const TEXT_FILE_RE = /\.(json|ya?ml|agent)$/i;

function assertValidProjectDir(projectDir) {
  if (typeof projectDir !== "string" || !projectDir.trim()) {
    throw new Error("A project directory is required.");
  }
  if (!path.isAbsolute(projectDir)) {
    throw new Error("Project directory must be an absolute path.");
  }
  let stat;
  try {
    stat = fs.statSync(projectDir);
  } catch {
    throw new Error(`Project directory does not exist: ${projectDir}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${projectDir}`);
  }
  if (!fs.existsSync(path.join(projectDir, DESCRIPTOR_FILE))) {
    throw new Error(
      `Not an Agent Network project — ${DESCRIPTOR_FILE} not found in ${projectDir}.`
    );
  }
}

function collectProjectEntries(projectDir) {
  /** @type {Array<{filename:string,content:string}>} */
  const entries = [];

  function walk(currentDir) {
    for (const name of fs.readdirSync(currentDir)) {
      const fullPath = path.join(currentDir, name);
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!TEXT_FILE_RE.test(name)) continue;
      entries.push({
        filename: path.relative(projectDir, fullPath).replace(/\\/g, "/"),
        content: fs.readFileSync(fullPath, "utf8"),
      });
    }
  }

  walk(projectDir);
  return entries;
}

/**
 * @param {string} projectDir
 * @returns {Array<{filename:string,content:string}>}
 */
function readLocalProjectEntries(projectDir) {
  assertValidProjectDir(projectDir);
  const entries = collectProjectEntries(projectDir);
  if (entries.length === 0) {
    throw new Error(`No project source files found in ${projectDir}.`);
  }
  return entries;
}

function assertWritableProjectDir(projectDir) {
  if (typeof projectDir !== "string" || !projectDir.trim()) {
    throw new Error("A project directory is required.");
  }
  if (!path.isAbsolute(projectDir)) {
    throw new Error("Project directory must be an absolute path.");
  }
  let stat;
  try {
    stat = fs.statSync(projectDir);
  } catch {
    throw new Error(`Project directory does not exist: ${projectDir}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${projectDir}`);
  }
}

/**
 * @param {string} projectDir
 * @param {Array<{filename:string,content:string}>} entries
 */
function writeLocalProjectEntries(projectDir, entries) {
  assertWritableProjectDir(projectDir);
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("Project files are required.");
  }

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const filename = String(entry.filename ?? "").trim();
    const content = String(entry.content ?? "");
    if (!filename || filename.includes("..") || path.isAbsolute(filename)) {
      throw new Error(`Invalid project file path: ${filename || "(empty)"}`);
    }
    // Belt and braces: resolve and confirm containment, so a name the checks
    // above miss (or a symlinked subdirectory) still can't escape the project.
    const dest = path.resolve(projectDir, filename);
    const root = path.resolve(projectDir) + path.sep;
    if (!dest.startsWith(root)) {
      throw new Error(`Invalid project file path: ${filename}`);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content, "utf8");
  }
}

module.exports = {
  readLocalProjectEntries,
  writeLocalProjectEntries,
  assertValidProjectDir,
};
