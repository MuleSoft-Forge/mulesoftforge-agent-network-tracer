// Read deploy metadata from an on-disk Agent Network project (exchange.json).

const fs = require("node:fs");
const path = require("node:path");

const DESCRIPTOR_FILE = "exchange.json";

function isVariableLeaf(value) {
  if (!value || typeof value !== "object") return false;
  return "default" in value || "secret" in value || "description" in value;
}

function flattenVariables(variables, prefix = "") {
  if (!variables || typeof variables !== "object" || Array.isArray(variables)) return [];

  /** @type {Array<{key:string,description?:string,default:string,secret:boolean}>} */
  const out = [];
  for (const [key, value] of Object.entries(variables)) {
    const dotKey = prefix ? `${prefix}.${key}` : key;
    if (isVariableLeaf(value)) {
      out.push({
        key: dotKey,
        description: typeof value.description === "string" ? value.description : undefined,
        default: typeof value.default === "string" ? value.default : "",
        secret: value.secret === true,
      });
      continue;
    }
    if (value && typeof value === "object") {
      out.push(...flattenVariables(value, dotKey));
    }
  }
  return out;
}

/**
 * @param {string} projectDir
 * @returns {{ projectName?: string, variables: Array<{key:string,description?:string,default:string,secret:boolean}> }}
 */
function readProjectDeployMeta(projectDir) {
  const filePath = path.join(projectDir, DESCRIPTOR_FILE);
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    throw new Error(`Could not read ${DESCRIPTOR_FILE} in ${projectDir}.`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${DESCRIPTOR_FILE} is not valid JSON.`);
  }

  const variables = flattenVariables(parsed?.metadata?.variables);
  const projectName =
    typeof parsed?.name === "string"
      ? parsed.name
      : typeof parsed?.assetId === "string"
        ? parsed.assetId
        : undefined;

  return { projectName, variables };
}

module.exports = { readProjectDeployMeta, flattenVariables };
