import type { SerializedFile } from "@/lib/composer/serialize";
import type { ProjectZipEntry } from "@/lib/composer/import/select-project-files";
import { selectProjectSourceFiles } from "@/lib/composer/import/select-project-files";
import {
  countDiffStats,
  diffLineRows,
  formatUnifiedDiff,
  type DiffRow,
} from "@/lib/composer/compare/line-diff";

export type CompareFileStatus = "match" | "diff" | "missing-baseline" | "missing-current";

export interface FileCompareResult {
  /** Path in the live serialized project (e.g. brokers/foo.agent). */
  path: string;
  /** Best-effort path in the baseline folder, when known. */
  baselinePath?: string;
  status: CompareFileStatus;
  currentBytes: number;
  baselineBytes: number;
  rows: DiffRow[];
  unifiedDiff: string;
  stats: ReturnType<typeof countDiffStats>;
}

export interface ProjectCompareResult {
  baselineLabel: string;
  comparedAt: string;
  files: FileCompareResult[];
  summary: {
    total: number;
    matching: number;
    differing: number;
    missingBaseline: number;
  };
  reportMarkdown: string;
}

function basename(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

/** Map baseline zip/folder entries to the three core project files. */
export function baselineFromEntries(entries: ProjectZipEntry[], label: string) {
  const picked = selectProjectSourceFiles(entries);
  const exchangeEntry = entries.find((e) => basename(e.filename).toLowerCase() === "exchange.json");
  const yamlEntry = entries.find(
    (e) =>
      /agent-network\.ya?ml$/i.test(basename(e.filename)) ||
      (picked.agentYaml && e.content === picked.agentYaml)
  );
  const agentEntry = entries.find((e) => /\.agent$/i.test(e.filename) && e.content === picked.brokerAgent);

  return {
    label,
    exchangeJson: picked.exchangeJson,
    agentYaml: picked.agentYaml,
    brokerAgent: picked.brokerAgent,
    paths: {
      exchangeJson: exchangeEntry?.filename,
      agentYaml: yamlEntry?.filename,
      brokerAgent: agentEntry?.filename,
    },
  };
}

function compareOne(
  path: string,
  baselinePath: string | undefined,
  baseline: string | undefined,
  current: string | undefined
): FileCompareResult {
  const currentText = current ?? "";
  const baselineText = baseline ?? "";

  if (baseline === undefined) {
    return {
      path,
      baselinePath,
      status: "missing-baseline",
      currentBytes: currentText.length,
      baselineBytes: 0,
      rows: [],
      unifiedDiff: "",
      stats: { added: 0, removed: 0, changed: 0, same: 0 },
    };
  }

  if (current === undefined) {
    return {
      path,
      baselinePath,
      status: "missing-current",
      currentBytes: 0,
      baselineBytes: baselineText.length,
      rows: [],
      unifiedDiff: "",
      stats: { added: 0, removed: 0, changed: 0, same: 0 },
    };
  }

  const rows = diffLineRows(baselineText, currentText);
  const stats = countDiffStats(rows);
  const match = rows.every((r) => r.kind === "same");

  return {
    path,
    baselinePath,
    status: match ? "match" : "diff",
    currentBytes: currentText.length,
    baselineBytes: baselineText.length,
    rows,
    unifiedDiff: match ? "" : formatUnifiedDiff(path, baselineText, currentText),
    stats,
  };
}

/** Compare live serialized files against a baseline folder/zip entry set. */
export function compareProjectWithBaseline(
  currentFiles: SerializedFile[],
  baselineEntries: ProjectZipEntry[],
  baselineLabel: string
): ProjectCompareResult {
  const baseline = baselineFromEntries(baselineEntries, baselineLabel);

  const byLang = new Map(currentFiles.map((f) => [f.language, f]));

  const slots: Array<{
    path: string;
    baselinePath?: string;
    baseline?: string;
    current?: string;
  }> = [
    {
      path: byLang.get("json")?.path ?? "exchange.json",
      baselinePath: baseline.paths.exchangeJson,
      baseline: baseline.exchangeJson,
      current: byLang.get("json")?.content,
    },
    {
      path: byLang.get("yaml")?.path ?? "agent-network.yaml",
      baselinePath: baseline.paths.agentYaml,
      baseline: baseline.agentYaml,
      current: byLang.get("yaml")?.content,
    },
    {
      path: byLang.get("agent")?.path ?? "brokers/broker.agent",
      baselinePath: baseline.paths.brokerAgent,
      baseline: baseline.brokerAgent,
      current: byLang.get("agent")?.content,
    },
  ];

  const files = slots.map((s) => compareOne(s.path, s.baselinePath, s.baseline, s.current));

  const matching = files.filter((f) => f.status === "match").length;
  const differing = files.filter((f) => f.status === "diff").length;
  const missingBaseline = files.filter((f) => f.status === "missing-baseline").length;

  const comparedAt = new Date().toISOString();
  const reportMarkdown = buildReportMarkdown(baselineLabel, comparedAt, files, {
    total: files.length,
    matching,
    differing,
    missingBaseline,
  });

  return {
    baselineLabel,
    comparedAt,
    files,
    summary: { total: files.length, matching, differing, missingBaseline },
    reportMarkdown,
  };
}

function buildReportMarkdown(
  baselineLabel: string,
  comparedAt: string,
  files: FileCompareResult[],
  summary: ProjectCompareResult["summary"]
): string {
  const lines: string[] = [
    `# Project compare — live model vs \`${baselineLabel}\``,
    "",
    `- Compared at: ${comparedAt}`,
    `- Files: ${summary.matching}/${summary.total} match, ${summary.differing} differ${
      summary.missingBaseline > 0 ? `, ${summary.missingBaseline} missing in baseline` : ""
    }`,
    "",
  ];

  for (const f of files) {
    lines.push(`## ${f.path}`);
    if (f.baselinePath && f.baselinePath !== f.path) {
      lines.push(`Baseline path: \`${f.baselinePath}\``);
    }
    lines.push(
      `- Status: **${f.status}** · baseline ${f.baselineBytes} B · current ${f.currentBytes} B · +${f.stats.added} / -${f.stats.removed} lines`
    );
    lines.push("");

    if (f.status === "match") {
      lines.push("_No differences._");
    } else if (f.unifiedDiff) {
      lines.push("```diff");
      lines.push(f.unifiedDiff);
      lines.push("```");
    } else if (f.status === "missing-baseline") {
      lines.push("_Baseline file not found in chosen folder._");
    } else if (f.status === "missing-current") {
      lines.push("_Not emitted by current model._");
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
