// Main-process logging to a file.
//
// A packaged app launched from Finder has no terminal attached, so anything
// written to stdout/stderr is lost — including the reason it failed to start.
// Everything goes to a rolling log inside the app's config dir instead:
//
//   ~/Library/Logs/Agent Network Tracer/main.log   (macOS)
//   %APPDATA%\Agent Network Tracer\logs\main.log   (Windows)

const fs = require("node:fs");
const path = require("node:path");

const MAX_BYTES = 2 * 1024 * 1024; // keep one previous log, cap each at 2 MB

let stream = null;
let logPath = null;

/** Open the log file. Safe to call once app paths are available. */
function initLogging(logDir) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    logPath = path.join(logDir, "main.log");

    // Roll if the current log has grown past the cap.
    try {
      if (fs.statSync(logPath).size > MAX_BYTES) {
        fs.renameSync(logPath, path.join(logDir, "main.previous.log"));
      }
    } catch {
      // no existing log
    }

    stream = fs.createWriteStream(logPath, { flags: "a" });
    stream.on("error", () => {
      stream = null; // disk full / read-only — degrade to console only
    });
  } catch {
    stream = null;
  }
  return logPath;
}

/** Write a line to the log file and the console. */
function logLine(message) {
  const line = `${new Date().toISOString()} ${message}`;
  // eslint-disable-next-line no-console
  console.log(line);
  if (stream) {
    try {
      stream.write(`${line}\n`);
    } catch {
      // ignore
    }
  }
}

/** Write raw child-process output (already includes newlines). */
function logRaw(chunk) {
  const text = chunk.toString();
  process.stdout.write(text);
  if (stream) {
    try {
      stream.write(text);
    } catch {
      // ignore
    }
  }
}

function getLogPath() {
  return logPath;
}

module.exports = { initLogging, logLine, logRaw, getLogPath };
