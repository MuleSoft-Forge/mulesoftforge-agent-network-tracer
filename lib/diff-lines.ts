/**
 * Simple line-based diff algorithm (Myers-like LCS approach).
 * Produces unified-diff-style output without external dependencies.
 */

export type DiffLineType = "unchanged" | "added" | "removed";

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

/**
 * Compute the longest common subsequence table for two string arrays.
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp;
}

/**
 * Produce a line-by-line diff between two text strings.
 * Returns an array of DiffLine objects suitable for rendering.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const aLines = before.split("\n");
  const bLines = after.split("\n");
  const dp = lcsTable(aLines, bLines);

  const result: DiffLine[] = [];
  let i = aLines.length;
  let j = bLines.length;

  const stack: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aLines[i - 1] === bLines[j - 1]) {
      stack.push({
        type: "unchanged",
        content: aLines[i - 1],
        oldLineNumber: i,
        newLineNumber: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({
        type: "added",
        content: bLines[j - 1],
        oldLineNumber: null,
        newLineNumber: j,
      });
      j--;
    } else {
      stack.push({
        type: "removed",
        content: aLines[i - 1],
        oldLineNumber: i,
        newLineNumber: null,
      });
      i--;
    }
  }

  while (stack.length > 0) {
    result.push(stack.pop()!);
  }

  return result;
}

export interface DiffStats {
  added: number;
  removed: number;
  unchanged: number;
}

export function diffStats(lines: DiffLine[]): DiffStats {
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const line of lines) {
    switch (line.type) {
      case "added":
        added++;
        break;
      case "removed":
        removed++;
        break;
      case "unchanged":
        unchanged++;
        break;
    }
  }
  return { added, removed, unchanged };
}
