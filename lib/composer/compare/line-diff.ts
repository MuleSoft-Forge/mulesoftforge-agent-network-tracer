/** Line-oriented diff for project file comparison (no external deps). */

export type DiffRowKind = "same" | "add" | "remove";

export interface DiffRow {
  kind: DiffRowKind;
  /** 1-based line in left (baseline), when present */
  leftNo?: number;
  /** 1-based line in right (current), when present */
  rightNo?: number;
  left?: string;
  right?: string;
}

/** Longest common subsequence table for line arrays. */
function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp;
}

function backtrack(a: string[], b: string[], dp: number[][]): DiffRow[] {
  const rows: DiffRow[] = [];
  let i = a.length;
  let j = b.length;
  const stack: DiffRow[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      stack.push({ kind: "same", leftNo: i, rightNo: j, left: a[i - 1], right: b[j - 1] });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ kind: "add", rightNo: j, right: b[j - 1] });
      j -= 1;
    } else {
      stack.push({ kind: "remove", leftNo: i, left: a[i - 1] });
      i -= 1;
    }
  }

  while (stack.length > 0) rows.push(stack.pop()!);
  return rows;
}

export function splitLines(text: string): string[] {
  if (text === "") return [];
  return text.replace(/\n$/, "").split("\n");
}

/** Diff two texts line-by-line (baseline = left, current = right). */
export function diffLineRows(baseline: string, current: string): DiffRow[] {
  const a = splitLines(baseline);
  const b = splitLines(current);
  if (a.length === 0 && b.length === 0) return [];
  return backtrack(a, b, lcsTable(a, b));
}

export function countDiffStats(rows: DiffRow[]): { added: number; removed: number; changed: number; same: number } {
  let added = 0;
  let removed = 0;
  let same = 0;
  for (const row of rows) {
    if (row.kind === "add") added += 1;
    else if (row.kind === "remove") removed += 1;
    else same += 1;
  }
  // "changed" pairs are adjacent remove+add in unified view; count as max of add/remove for summary
  return { added, removed, changed: Math.min(added, removed), same };
}

/** Unified diff text (similar to `diff -u`). */
export function formatUnifiedDiff(
  path: string,
  baseline: string,
  current: string,
  context = 3
): string {
  const rows = diffLineRows(baseline, current);
  if (rows.every((r) => r.kind === "same")) return "";

  const lines: string[] = [`--- ${path} (baseline)`, `+++ ${path} (current)`];
  let i = 0;

  while (i < rows.length) {
    if (rows[i].kind === "same") {
      i += 1;
      continue;
    }

    const hunkStart = i;
    let hunkEnd = i;
    while (hunkEnd < rows.length && rows[hunkEnd].kind !== "same") hunkEnd += 1;

    const leftStart = rows[hunkStart].leftNo ?? rows.slice(hunkStart, hunkEnd).find((r) => r.leftNo)?.leftNo ?? 1;
    const rightStart = rows[hunkStart].rightNo ?? rows.slice(hunkStart, hunkEnd).find((r) => r.rightNo)?.rightNo ?? 1;

    const ctxBefore = rows.slice(Math.max(0, hunkStart - context), hunkStart);
    const ctxAfter = rows.slice(hunkEnd, Math.min(rows.length, hunkEnd + context));
    const hunkRows = [...ctxBefore, ...rows.slice(hunkStart, hunkEnd), ...ctxAfter];

    const leftCount = hunkRows.filter((r) => r.kind !== "add").length;
    const rightCount = hunkRows.filter((r) => r.kind !== "remove").length;

    lines.push(`@@ -${leftStart},${leftCount} +${rightStart},${rightCount} @@`);
    for (const row of hunkRows) {
      if (row.kind === "same") lines.push(` ${row.left ?? ""}`);
      else if (row.kind === "remove") lines.push(`-${row.left ?? ""}`);
      else lines.push(`+${row.right ?? ""}`);
    }

    i = hunkEnd;
  }

  return lines.join("\n");
}
