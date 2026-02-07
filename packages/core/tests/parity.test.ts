import { describe, expect, test } from "bun:test";

import {
  compareParityData,
  computeStats,
  filterComments,
  formatParityResult,
  type CommentType,
  type ParityComment,
  type ParityData,
  type ParityFilterOptions,
} from "../src/parity";

/** Helper to create a ParityComment */
function makeComment(
  id: string,
  pr: number,
  type: CommentType,
  isResolved?: boolean,
  author = "user"
): ParityComment {
  return { id, pr, type, author, isResolved };
}

/** Helper to create empty ParityData */
function emptyData(): ParityData {
  return {
    reviewComments: new Map(),
    issueComments: new Map(),
  };
}

describe("computeStats", () => {
  test("returns zeros for empty data", () => {
    const stats = computeStats(emptyData(), emptyData());

    expect(stats.review_comments.gh_total).toBe(0);
    expect(stats.review_comments.fw_total).toBe(0);
    expect(stats.issue_comments.gh_total).toBe(0);
    expect(stats.issue_comments.fw_total).toBe(0);
  });

  test("counts review comments with resolution state", () => {
    const gh: ParityData = {
      reviewComments: new Map([
        ["C1", makeComment("C1", 42, "review_comment", false)],
        ["C2", makeComment("C2", 42, "review_comment", true)],
        ["C3", makeComment("C3", 43, "review_comment", false)],
      ]),
      issueComments: new Map(),
    };

    const fw: ParityData = {
      reviewComments: new Map([
        ["C1", makeComment("C1", 42, "review_comment", false)],
        ["C2", makeComment("C2", 42, "review_comment", true)],
      ]),
      issueComments: new Map(),
    };

    const stats = computeStats(gh, fw);

    expect(stats.review_comments.gh_total).toBe(3);
    expect(stats.review_comments.gh_resolved).toBe(1);
    expect(stats.review_comments.gh_unresolved).toBe(2);
    expect(stats.review_comments.fw_total).toBe(2);
    expect(stats.review_comments.fw_resolved).toBe(1);
    expect(stats.review_comments.fw_unresolved).toBe(1);
  });

  test("counts issue comments", () => {
    const gh: ParityData = {
      reviewComments: new Map(),
      issueComments: new Map([
        ["IC1", makeComment("IC1", 42, "issue_comment")],
        ["IC2", makeComment("IC2", 42, "issue_comment")],
      ]),
    };

    const fw: ParityData = {
      reviewComments: new Map(),
      issueComments: new Map([
        ["IC1", makeComment("IC1", 42, "issue_comment")],
      ]),
    };

    const stats = computeStats(gh, fw);

    expect(stats.issue_comments.gh_total).toBe(2);
    expect(stats.issue_comments.fw_total).toBe(1);
  });
});

describe("filterComments", () => {
  test("returns all comments with no filters", () => {
    const comments = new Map([
      ["C1", makeComment("C1", 42, "review_comment", false)],
      ["IC1", makeComment("IC1", 42, "issue_comment")],
    ]);

    const filtered = filterComments(comments, {});

    expect(filtered.size).toBe(2);
  });

  test("filters by type", () => {
    const comments = new Map([
      ["C1", makeComment("C1", 42, "review_comment", false)],
      ["IC1", makeComment("IC1", 42, "issue_comment")],
    ]);

    const reviewOnly = filterComments(comments, { type: "review_comment" });
    expect(reviewOnly.size).toBe(1);
    expect(reviewOnly.has("C1")).toBe(true);

    const issueOnly = filterComments(comments, { type: "issue_comment" });
    expect(issueOnly.size).toBe(1);
    expect(issueOnly.has("IC1")).toBe(true);
  });

  test("filters by resolved state", () => {
    const comments = new Map([
      ["C1", makeComment("C1", 42, "review_comment", false)],
      ["C2", makeComment("C2", 42, "review_comment", true)],
    ]);

    const resolvedOnly = filterComments(comments, { resolved: true });
    expect(resolvedOnly.size).toBe(1);
    expect(resolvedOnly.has("C2")).toBe(true);

    const unresolvedOnly = filterComments(comments, { unresolved: true });
    expect(unresolvedOnly.size).toBe(1);
    expect(unresolvedOnly.has("C1")).toBe(true);
  });

  test("resolution filters do not affect issue comments", () => {
    const comments = new Map([
      ["IC1", makeComment("IC1", 42, "issue_comment")],
    ]);

    const filtered = filterComments(comments, { resolved: true });
    // Issue comments pass through resolution filters (they don't have resolution state)
    expect(filtered.size).toBe(1);
  });
});

describe("compareParityData", () => {
  test("returns match for empty data", () => {
    const result = compareParityData("owner/repo", emptyData(), emptyData());

    expect(result.match).toBe(true);
    expect(result.discrepancies).toHaveLength(0);
  });

  test("returns match when data is identical", () => {
    const data: ParityData = {
      reviewComments: new Map([
        ["C1", makeComment("C1", 42, "review_comment", false)],
      ]),
      issueComments: new Map([
        ["IC1", makeComment("IC1", 42, "issue_comment")],
      ]),
    };

    const result = compareParityData("owner/repo", data, data);

    expect(result.match).toBe(true);
    expect(result.discrepancies).toHaveLength(0);
  });

  test("detects missing in Firewatch", () => {
    const gh: ParityData = {
      reviewComments: new Map([
        ["C1", makeComment("C1", 42, "review_comment", false)],
      ]),
      issueComments: new Map(),
    };

    const result = compareParityData("owner/repo", gh, emptyData());

    expect(result.match).toBe(false);
    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0]?.kind).toBe("missing_in_fw");
    expect(result.discrepancies[0]?.id).toBe("C1");
  });

  test("detects extra in Firewatch", () => {
    const fw: ParityData = {
      reviewComments: new Map([
        ["C1", makeComment("C1", 42, "review_comment", false)],
      ]),
      issueComments: new Map(),
    };

    const result = compareParityData("owner/repo", emptyData(), fw);

    expect(result.match).toBe(false);
    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0]?.kind).toBe("extra_in_fw");
    expect(result.discrepancies[0]?.id).toBe("C1");
  });

  test("detects state mismatch for review comments", () => {
    const gh: ParityData = {
      reviewComments: new Map([
        ["C1", makeComment("C1", 42, "review_comment", true)], // resolved in GH
      ]),
      issueComments: new Map(),
    };

    const fw: ParityData = {
      reviewComments: new Map([
        ["C1", makeComment("C1", 42, "review_comment", false)], // unresolved in FW
      ]),
      issueComments: new Map(),
    };

    const result = compareParityData("owner/repo", gh, fw);

    expect(result.match).toBe(false);
    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0]?.kind).toBe("state_mismatch");
    expect(result.discrepancies[0]?.ghResolved).toBe(true);
    expect(result.discrepancies[0]?.fwResolved).toBe(false);
  });

  test("respects type filter", () => {
    const gh: ParityData = {
      reviewComments: new Map([
        ["C1", makeComment("C1", 42, "review_comment", false)],
      ]),
      issueComments: new Map([
        ["IC1", makeComment("IC1", 42, "issue_comment")],
      ]),
    };

    // Only review comments in FW
    const fw: ParityData = {
      reviewComments: new Map([
        ["C1", makeComment("C1", 42, "review_comment", false)],
      ]),
      issueComments: new Map(),
    };

    // With type filter for review_comment, should match
    const filtered = compareParityData("owner/repo", gh, fw, {
      type: "review_comment",
    });
    expect(filtered.match).toBe(true);

    // Without filter, should detect missing issue comment
    const unfiltered = compareParityData("owner/repo", gh, fw);
    expect(unfiltered.match).toBe(false);
    expect(unfiltered.discrepancies).toHaveLength(1);
    expect(unfiltered.discrepancies[0]?.type).toBe("issue_comment");
  });

  test("respects unresolved filter", () => {
    const gh: ParityData = {
      reviewComments: new Map([
        ["C1", makeComment("C1", 42, "review_comment", false)], // unresolved
        ["C2", makeComment("C2", 42, "review_comment", true)], // resolved
      ]),
      issueComments: new Map(),
    };

    // FW only has the unresolved one
    const fw: ParityData = {
      reviewComments: new Map([
        ["C1", makeComment("C1", 42, "review_comment", false)],
      ]),
      issueComments: new Map(),
    };

    // With unresolved filter, should match (only comparing unresolved)
    const filtered = compareParityData("owner/repo", gh, fw, {
      unresolved: true,
    });
    expect(filtered.match).toBe(true);

    // Without filter, should detect missing resolved comment
    const unfiltered = compareParityData("owner/repo", gh, fw);
    expect(unfiltered.match).toBe(false);
  });

  test("sorts discrepancies by PR number", () => {
    const gh: ParityData = {
      reviewComments: new Map([
        ["C1", makeComment("C1", 50, "review_comment", false)],
        ["C2", makeComment("C2", 42, "review_comment", false)],
        ["C3", makeComment("C3", 45, "review_comment", false)],
      ]),
      issueComments: new Map(),
    };

    const result = compareParityData("owner/repo", gh, emptyData());

    expect(result.discrepancies).toHaveLength(3);
    expect(result.discrepancies[0]?.pr).toBe(42);
    expect(result.discrepancies[1]?.pr).toBe(45);
    expect(result.discrepancies[2]?.pr).toBe(50);
  });

  test("preserves repo and filters in result", () => {
    const filters: ParityFilterOptions = {
      type: "review_comment",
      unresolved: true,
    };
    const result = compareParityData(
      "outfitter-dev/firewatch",
      emptyData(),
      emptyData(),
      filters
    );

    expect(result.repo).toBe("outfitter-dev/firewatch");
    expect(result.filters).toEqual(filters);
  });
});

describe("formatParityResult (new)", () => {
  test("formats matching result with statistics", () => {
    const gh: ParityData = {
      reviewComments: new Map([
        ["C1", makeComment("C1", 42, "review_comment", false)],
      ]),
      issueComments: new Map([
        ["IC1", makeComment("IC1", 42, "issue_comment")],
      ]),
    };

    const result = compareParityData("owner/repo", gh, gh);
    const output = formatParityResult(result);

    expect(output).toContain("owner/repo");
    expect(output).toContain("✓ MATCH");
    expect(output).toContain("Review Comments:");
    expect(output).toContain("Issue Comments:");
    expect(output).toContain("GitHub:    1 total");
  });

  test("formats mismatching result with discrepancies", () => {
    const gh: ParityData = {
      reviewComments: new Map([
        ["C1", makeComment("C1", 42, "review_comment", false)],
        ["C2", makeComment("C2", 42, "review_comment", true)],
      ]),
      issueComments: new Map(),
    };

    const fw: ParityData = {
      reviewComments: new Map([
        ["C1", makeComment("C1", 42, "review_comment", true)], // state mismatch
        ["C3", makeComment("C3", 42, "review_comment", false)], // extra
      ]),
      issueComments: new Map(),
    };

    const result = compareParityData("owner/repo", gh, fw);
    const output = formatParityResult(result);

    expect(output).toContain("✗ MISMATCH");
    expect(output).toContain("Missing in Firewatch:");
    expect(output).toContain("Extra in Firewatch:");
    expect(output).toContain("State Mismatch:");
    expect(output).toContain("C2");
    expect(output).toContain("C3");
    expect(output).toContain("gh: unresolved, fw: resolved");
  });

  test("formats active filters", () => {
    const result = compareParityData("owner/repo", emptyData(), emptyData(), {
      type: "review_comment",
      unresolved: true,
    });
    const output = formatParityResult(result);

    expect(output).toContain("type=review_comment");
    expect(output).toContain("unresolved");
  });

  test("formats no filters as 'none'", () => {
    const result = compareParityData("owner/repo", emptyData(), emptyData());
    const output = formatParityResult(result);

    expect(output).toContain("Filters: none");
  });
});
