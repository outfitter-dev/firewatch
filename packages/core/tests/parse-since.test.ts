import { expect, test } from "bun:test";

import { parseSince } from "../src/time";

test("parseSince subtracts hours", () => {
  const before = Date.now();
  const result = parseSince("24h");
  expect(result.isOk()).toBe(true);
  const date = result.value as Date;
  const after = Date.now();
  const expected = 24 * 60 * 60 * 1000;
  expect(date.getTime()).toBeGreaterThanOrEqual(before - expected);
  expect(date.getTime()).toBeLessThanOrEqual(after - expected);
});

test("parseSince subtracts days", () => {
  const before = Date.now();
  const result = parseSince("7d");
  expect(result.isOk()).toBe(true);
  const date = result.value as Date;
  const after = Date.now();
  const expected = 7 * 24 * 60 * 60 * 1000;
  expect(date.getTime()).toBeGreaterThanOrEqual(before - expected);
  expect(date.getTime()).toBeLessThanOrEqual(after - expected);
});

test("parseSince rejects invalid formats", () => {
  const result = parseSince("24");
  expect(result.isErr()).toBe(true);
});
