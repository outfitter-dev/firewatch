import { describe, expect, test } from "bun:test";

import {
  buildShortIdCache,
  classifyId,
  clearShortIdCache,
  formatShortId,
  generateShortId,
  resolveShortId,
} from "../src/short-id";

describe("generateShortId", () => {
  test("produces a 5-character hex string", () => {
    const id = generateShortId("IC_kwDOQ_abc123", "outfitter-dev/firewatch");
    expect(id).toMatch(/^[a-f0-9]{5}$/);
  });

  test("returns consistent output for the same input", () => {
    const a = generateShortId("IC_kwDOQ_abc123", "outfitter-dev/firewatch");
    const b = generateShortId("IC_kwDOQ_abc123", "outfitter-dev/firewatch");
    expect(a).toBe(b);
  });

  test("produces different IDs for different comment IDs", () => {
    const a = generateShortId("IC_kwDOQ_abc123", "outfitter-dev/firewatch");
    const b = generateShortId("IC_kwDOQ_xyz789", "outfitter-dev/firewatch");
    expect(a).not.toBe(b);
  });

  test("produces different IDs for different repos", () => {
    const a = generateShortId("IC_kwDOQ_abc123", "outfitter-dev/firewatch");
    const b = generateShortId("IC_kwDOQ_abc123", "outfitter-dev/other-repo");
    expect(a).not.toBe(b);
  });
});

describe("classifyId", () => {
  test("classifies numeric strings as pr_number", () => {
    expect(classifyId("42")).toBe("pr_number");
    expect(classifyId("1")).toBe("pr_number");
    expect(classifyId("9999")).toBe("pr_number");
  });

  test("classifies 5-char hex strings as short_id", () => {
    expect(classifyId("a1b2c")).toBe("short_id");
    expect(classifyId("@a1b2c")).toBe("short_id");
    expect(classifyId("[@a1b2c]")).toBe("short_id");
  });

  test("classifies long prefixed strings as full_id", () => {
    expect(classifyId("IC_kwDOQ_abc123xyz")).toBe("full_id");
    expect(classifyId("PRRC_kwDOQ_abc123xyz")).toBe("full_id");
  });

  test("returns unknown for unrecognized formats", () => {
    expect(classifyId("not-an-id")).toBe("unknown");
    expect(classifyId("")).toBe("unknown");
  });
});

describe("formatShortId", () => {
  test("adds @ prefix to a bare short ID", () => {
    expect(formatShortId("a1b2c")).toBe("@a1b2c");
  });

  test("normalizes an already-prefixed short ID", () => {
    expect(formatShortId("@A1B2C")).toBe("@a1b2c");
  });

  test("normalizes bracketed display format", () => {
    expect(formatShortId("[@a1b2c]")).toBe("@a1b2c");
  });
});

describe("buildShortIdCache + resolveShortId", () => {
  test("round-trips entries through build and resolve", () => {
    clearShortIdCache();

    const entries = [
      { id: "IC_kwDOQ_comment1", repo: "outfitter-dev/firewatch", pr: 10 },
      { id: "PRRC_kwDOQ_comment2", repo: "outfitter-dev/firewatch", pr: 11 },
    ];

    buildShortIdCache(entries);

    for (const entry of entries) {
      const shortId = generateShortId(entry.id, entry.repo);
      const resolved = resolveShortId(shortId);
      expect(resolved).not.toBeNull();
      expect(resolved!.fullId).toBe(entry.id);
      expect(resolved!.repo).toBe(entry.repo);
      expect(resolved!.pr).toBe(entry.pr);
    }
  });

  test("resolves short IDs with @ prefix", () => {
    clearShortIdCache();

    const entries = [
      { id: "IC_kwDOQ_comment1", repo: "outfitter-dev/firewatch", pr: 10 },
    ];

    buildShortIdCache(entries);

    const shortId = generateShortId(entries[0]!.id, entries[0]!.repo);
    const resolved = resolveShortId(`@${shortId}`);
    expect(resolved).not.toBeNull();
    expect(resolved!.fullId).toBe(entries[0]!.id);
  });

  test("returns null for an unknown short ID", () => {
    clearShortIdCache();
    const resolved = resolveShortId("fffff");
    expect(resolved).toBeNull();
  });
});
