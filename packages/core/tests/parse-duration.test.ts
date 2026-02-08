import { describe, expect, test } from "bun:test";

import { parseDurationMs } from "../src/time";

describe("parseDurationMs", () => {
  test("parses seconds", () => {
    const result = parseDurationMs("30s");
    expect(result.isOk()).toBe(true);
    expect(result.value).toBe(30_000);
  });

  test("parses minutes", () => {
    const result = parseDurationMs("5m");
    expect(result.isOk()).toBe(true);
    expect(result.value).toBe(300_000);
  });

  test("parses hours", () => {
    const result = parseDurationMs("2h");
    expect(result.isOk()).toBe(true);
    expect(result.value).toBe(7_200_000);
  });

  test("parses days", () => {
    const result = parseDurationMs("7d");
    expect(result.isOk()).toBe(true);
    expect(result.value).toBe(604_800_000);
  });

  test("parses weeks", () => {
    const result = parseDurationMs("1w");
    expect(result.isOk()).toBe(true);
    expect(result.value).toBe(604_800_000);
  });

  test("rejects invalid format", () => {
    const result = parseDurationMs("invalid");
    expect(result.isErr()).toBe(true);
  });

  test("rejects number without unit", () => {
    const result = parseDurationMs("24");
    expect(result.isErr()).toBe(true);
  });
});
