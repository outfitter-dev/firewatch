import { describe, expect, test } from "bun:test";

import {
  compareThreads,
  formatParityResult,
  type GitHubThreadData,
} from "../src/parity";

describe("compareThreads", () => {
  test("returns match when both sources are empty", () => {
    const result = compareThreads("owner/repo", new Map(), new Map());

    expect(result.match).toBe(true);
    expect(result.ghThreadCount).toBe(0);
    expect(result.fwThreadCount).toBe(0);
    expect(result.missingInFw).toHaveLength(0);
    expect(result.extraInFw).toHaveLength(0);
  });

  test("returns match when both sources have identical data", () => {
    const ghByPr = new Map<number, GitHubThreadData[]>([
      [
        42,
        [
          { pr: 42, threadId: "T1", commentId: "C1" },
          { pr: 42, threadId: "T2", commentId: "C2" },
        ],
      ],
      [43, [{ pr: 43, threadId: "T3", commentId: "C3" }]],
    ]);

    const fwByPr = new Map<number, string[]>([
      [42, ["C1", "C2"]],
      [43, ["C3"]],
    ]);

    const result = compareThreads("owner/repo", ghByPr, fwByPr);

    expect(result.match).toBe(true);
    expect(result.ghThreadCount).toBe(3);
    expect(result.fwThreadCount).toBe(3);
    expect(result.missingInFw).toHaveLength(0);
    expect(result.extraInFw).toHaveLength(0);
  });

  test("detects missing threads in Firewatch", () => {
    const ghByPr = new Map<number, GitHubThreadData[]>([
      [
        42,
        [
          { pr: 42, threadId: "T1", commentId: "C1" },
          { pr: 42, threadId: "T2", commentId: "C2" },
        ],
      ],
    ]);

    // Firewatch is missing C2
    const fwByPr = new Map<number, string[]>([[42, ["C1"]]]);

    const result = compareThreads("owner/repo", ghByPr, fwByPr);

    expect(result.match).toBe(false);
    expect(result.ghThreadCount).toBe(2);
    expect(result.fwThreadCount).toBe(1);
    expect(result.missingInFw).toHaveLength(1);
    expect(result.missingInFw[0]?.commentId).toBe("C2");
    expect(result.extraInFw).toHaveLength(0);
  });

  test("detects extra threads in Firewatch", () => {
    const ghByPr = new Map<number, GitHubThreadData[]>([
      [42, [{ pr: 42, threadId: "T1", commentId: "C1" }]],
    ]);

    // Firewatch has an extra entry
    const fwByPr = new Map<number, string[]>([[42, ["C1", "C2"]]]);

    const result = compareThreads("owner/repo", ghByPr, fwByPr);

    expect(result.match).toBe(false);
    expect(result.ghThreadCount).toBe(1);
    expect(result.fwThreadCount).toBe(2);
    expect(result.missingInFw).toHaveLength(0);
    expect(result.extraInFw).toHaveLength(1);
    expect(result.extraInFw[0]).toBe("C2");
  });

  test("detects both missing and extra threads", () => {
    const ghByPr = new Map<number, GitHubThreadData[]>([
      [42, [{ pr: 42, threadId: "T1", commentId: "C1" }]],
      [43, [{ pr: 43, threadId: "T2", commentId: "C2" }]],
    ]);

    // Firewatch has C1 but not C2, and has extra C3
    const fwByPr = new Map<number, string[]>([[42, ["C1", "C3"]]]);

    const result = compareThreads("owner/repo", ghByPr, fwByPr);

    expect(result.match).toBe(false);
    expect(result.ghThreadCount).toBe(2);
    expect(result.fwThreadCount).toBe(2);
    expect(result.missingInFw).toHaveLength(1);
    expect(result.missingInFw[0]?.commentId).toBe("C2");
    expect(result.extraInFw).toHaveLength(1);
    expect(result.extraInFw[0]).toBe("C3");
  });

  test("handles threads without commentId gracefully", () => {
    const ghByPr = new Map<number, GitHubThreadData[]>([
      [
        42,
        [
          { pr: 42, threadId: "T1", commentId: "C1" },
          { pr: 42, threadId: "T2" }, // No commentId
        ],
      ],
    ]);

    const fwByPr = new Map<number, string[]>([[42, ["C1"]]]);

    const result = compareThreads("owner/repo", ghByPr, fwByPr);

    // Thread without commentId should not be counted as missing
    // (we can only match on commentId)
    expect(result.match).toBe(false); // Counts don't match (2 vs 1)
    expect(result.ghThreadCount).toBe(2);
    expect(result.fwThreadCount).toBe(1);
    expect(result.missingInFw).toHaveLength(0); // No commentId = can't detect as missing
  });

  test("handles disjoint PR sets", () => {
    const ghByPr = new Map<number, GitHubThreadData[]>([
      [42, [{ pr: 42, threadId: "T1", commentId: "C1" }]],
    ]);

    const fwByPr = new Map<number, string[]>([[43, ["C2"]]]);

    const result = compareThreads("owner/repo", ghByPr, fwByPr);

    expect(result.match).toBe(false);
    expect(result.ghThreadCount).toBe(1);
    expect(result.fwThreadCount).toBe(1);
    expect(result.missingInFw).toHaveLength(1);
    expect(result.missingInFw[0]?.commentId).toBe("C1");
    expect(result.extraInFw).toHaveLength(1);
    expect(result.extraInFw[0]).toBe("C2");
  });

  test("preserves repo in result", () => {
    const result = compareThreads(
      "outfitter-dev/firewatch",
      new Map(),
      new Map()
    );

    expect(result.repo).toBe("outfitter-dev/firewatch");
  });
});

describe("formatParityResult", () => {
  test("formats matching result", () => {
    const result = compareThreads(
      "owner/repo",
      new Map([[42, [{ pr: 42, threadId: "T1", commentId: "C1" }]]]),
      new Map([[42, ["C1"]]])
    );

    const output = formatParityResult(result);

    expect(output).toContain("owner/repo");
    expect(output).toContain("GitHub unresolved threads:    1");
    expect(output).toContain("Firewatch unresolved threads: 1");
    expect(output).toContain("✓ MATCH");
    expect(output).not.toContain("Details");
  });

  test("formats mismatching result with details", () => {
    const result = compareThreads(
      "owner/repo",
      new Map([
        [42, [{ pr: 42, threadId: "T1", commentId: "C1" }]],
        [43, [{ pr: 43, threadId: "T2", commentId: "C2" }]],
      ]),
      new Map([[42, ["C1", "C3"]]])
    );

    const output = formatParityResult(result);

    expect(output).toContain("✗ MISMATCH");
    expect(output).toContain("Details");
    expect(output).toContain("GitHub threads by PR:");
    expect(output).toContain("PR #42: 1 unresolved");
    expect(output).toContain("PR #43: 1 unresolved");
    expect(output).toContain("Firewatch threads by PR:");
    expect(output).toContain("PR #42: 2 unresolved");
    expect(output).toContain("Missing in Firewatch");
    expect(output).toContain("C2");
    expect(output).toContain("Extra in Firewatch");
    expect(output).toContain("C3");
  });

  test("formats result with only missing entries", () => {
    const result = compareThreads(
      "owner/repo",
      new Map([[42, [{ pr: 42, threadId: "T1", commentId: "C1" }]]]),
      new Map()
    );

    const output = formatParityResult(result);

    expect(output).toContain("Missing in Firewatch");
    expect(output).not.toContain("Extra in Firewatch");
  });

  test("formats result with only extra entries", () => {
    const result = compareThreads(
      "owner/repo",
      new Map(),
      new Map([[42, ["C1"]]])
    );

    const output = formatParityResult(result);

    expect(output).not.toContain("Missing in Firewatch");
    expect(output).toContain("Extra in Firewatch");
  });
});
