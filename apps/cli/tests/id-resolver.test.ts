import { describe, expect, test } from "bun:test";

import {
  formatShortId,
  generateShortId,
  isValidShortId,
  resolveId,
} from "../src/utils/id-resolver";

describe("resolveId", () => {
  describe("PR numbers", () => {
    test("resolves single digit PR number", () => {
      const result = resolveId("1");
      expect(result.type).toBe("pr");
      expect(result.id).toBe("1");
      expect(result.raw).toBe("1");
      expect(result.shortId).toBeUndefined();
    });

    test("resolves multi-digit PR number", () => {
      const result = resolveId("42");
      expect(result.type).toBe("pr");
      expect(result.id).toBe("42");
      expect(result.raw).toBe("42");
    });

    test("resolves large PR number", () => {
      const result = resolveId("99999");
      expect(result.type).toBe("pr");
      expect(result.id).toBe("99999");
    });

    test("resolves zero as PR number", () => {
      const result = resolveId("0");
      expect(result.type).toBe("pr");
      expect(result.id).toBe("0");
    });

    test("handles whitespace around PR number", () => {
      const result = resolveId("  123  ");
      expect(result.type).toBe("pr");
      expect(result.id).toBe("123");
      expect(result.raw).toBe("  123  ");
    });
  });

  describe("short IDs", () => {
    test("resolves lowercase short ID", () => {
      const result = resolveId("@abc12");
      expect(result.type).toBe("comment");
      expect(result.shortId).toBe("abc12");
      expect(result.id).toBe(""); // Not resolved yet
      expect(result.raw).toBe("@abc12");
    });

    test("resolves uppercase short ID (normalized to lowercase)", () => {
      const result = resolveId("@ABC12");
      expect(result.type).toBe("comment");
      expect(result.shortId).toBe("abc12");
    });

    test("resolves all-zeros short ID", () => {
      const result = resolveId("@00000");
      expect(result.type).toBe("comment");
      expect(result.shortId).toBe("00000");
    });

    test("resolves all-f's short ID", () => {
      const result = resolveId("@fffff");
      expect(result.type).toBe("comment");
      expect(result.shortId).toBe("fffff");
    });

    test("resolves mixed case short ID", () => {
      const result = resolveId("@AbC12");
      expect(result.type).toBe("comment");
      expect(result.shortId).toBe("abc12");
    });
  });

  describe("full comment IDs", () => {
    test("resolves PRRC_ (pull request review comment)", () => {
      const fullId = "PRRC_kwDOABC123";
      const result = resolveId(fullId);
      expect(result.type).toBe("comment");
      expect(result.id).toBe(fullId);
      expect(result.shortId).toBeDefined();
      expect(result.raw).toBe(fullId);
    });

    test("resolves IC_ (issue comment)", () => {
      const fullId = "IC_1234567890";
      const result = resolveId(fullId);
      expect(result.type).toBe("comment");
      expect(result.id).toBe(fullId);
      expect(result.shortId).toBeDefined();
    });
  });

  describe("full review IDs", () => {
    test("resolves PRR_ (pull request review)", () => {
      const fullId = "PRR_kwDOABC123";
      const result = resolveId(fullId);
      expect(result.type).toBe("review");
      expect(result.id).toBe(fullId);
      expect(result.shortId).toBeUndefined();
      expect(result.raw).toBe(fullId);
    });
  });

  describe("invalid inputs", () => {
    test("throws on plain text", () => {
      expect(() => resolveId("abc")).toThrow(/Invalid ID format/);
    });

    test("throws on @ alone", () => {
      expect(() => resolveId("@")).toThrow(/Invalid ID format/);
    });

    test("throws on double @", () => {
      expect(() => resolveId("@@abc12")).toThrow(/Invalid ID format/);
    });

    test("throws on short ID with only 3 chars", () => {
      expect(() => resolveId("@xyz")).toThrow(/Invalid ID format/);
    });

    test("throws on short ID with 6 chars", () => {
      expect(() => resolveId("@abcdef")).toThrow(/Invalid ID format/);
    });

    test("throws on short ID with non-hex chars", () => {
      expect(() => resolveId("@ghijk")).toThrow(/Invalid ID format/);
    });

    test("throws on negative number", () => {
      expect(() => resolveId("-42")).toThrow(/Invalid ID format/);
    });

    test("throws on empty string", () => {
      expect(() => resolveId("")).toThrow(/Invalid ID format/);
    });

    test("throws on whitespace only", () => {
      expect(() => resolveId("   ")).toThrow(/Invalid ID format/);
    });
  });
});

describe("generateShortId", () => {
  test("generates 5-character hex string", () => {
    const shortId = generateShortId("PRRC_kwDOABC123");
    expect(shortId).toHaveLength(5);
    expect(shortId).toMatch(/^[0-9a-f]{5}$/);
  });

  test("is deterministic (same input produces same output)", () => {
    const input = "IC_1234567890";
    const first = generateShortId(input);
    const second = generateShortId(input);
    const third = generateShortId(input);
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  test("produces different outputs for different inputs", () => {
    const id1 = generateShortId("PRRC_kwDOABC123");
    const id2 = generateShortId("PRRC_kwDOXYZ789");
    const id3 = generateShortId("IC_1234567890");
    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
    expect(id1).not.toBe(id3);
  });

  test("produces lowercase output", () => {
    const shortId = generateShortId("PRRC_kwDOABC123");
    expect(shortId).toBe(shortId.toLowerCase());
  });
});

describe("formatShortId", () => {
  test("formats short ID with brackets and @", () => {
    expect(formatShortId("abc12")).toBe("[@abc12]");
  });

  test("normalizes to lowercase", () => {
    expect(formatShortId("ABC12")).toBe("[@abc12]");
  });

  test("handles all zeros", () => {
    expect(formatShortId("00000")).toBe("[@00000]");
  });

  test("handles all f's", () => {
    expect(formatShortId("fffff")).toBe("[@fffff]");
  });
});

describe("isValidShortId", () => {
  test("accepts valid lowercase short ID", () => {
    expect(isValidShortId("abc12")).toBe(true);
  });

  test("accepts valid uppercase short ID", () => {
    expect(isValidShortId("ABC12")).toBe(true);
  });

  test("accepts all zeros", () => {
    expect(isValidShortId("00000")).toBe(true);
  });

  test("accepts all f's", () => {
    expect(isValidShortId("fffff")).toBe(true);
  });

  test("accepts mixed case", () => {
    expect(isValidShortId("AbC12")).toBe(true);
  });

  test("rejects too short (3 chars)", () => {
    expect(isValidShortId("abc")).toBe(false);
  });

  test("rejects too short (4 chars)", () => {
    expect(isValidShortId("abcd")).toBe(false);
  });

  test("rejects too long (6 chars)", () => {
    expect(isValidShortId("abcdef")).toBe(false);
  });

  test("rejects non-hex characters (g)", () => {
    expect(isValidShortId("abcgd")).toBe(false);
  });

  test("rejects non-hex characters (z)", () => {
    expect(isValidShortId("abcdz")).toBe(false);
  });

  test("rejects with @ prefix", () => {
    expect(isValidShortId("@abc12")).toBe(false);
  });

  test("rejects empty string", () => {
    expect(isValidShortId("")).toBe(false);
  });

  test("rejects with spaces", () => {
    expect(isValidShortId("abc 2")).toBe(false);
  });
});
