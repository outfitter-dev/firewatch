import { expect, test } from "bun:test";

import { parseSince } from "../src/time";

test("parseSince subtracts hours", () => {
  const before = Date.now();
  const result = parseSince("24h");
  const after = Date.now();
  const expected = 24 * 60 * 60 * 1000;
  expect(result.getTime()).toBeGreaterThanOrEqual(before - expected);
  expect(result.getTime()).toBeLessThanOrEqual(after - expected);
});

test("parseSince subtracts days", () => {
  const before = Date.now();
  const result = parseSince("7d");
  const after = Date.now();
  const expected = 7 * 24 * 60 * 60 * 1000;
  expect(result.getTime()).toBeGreaterThanOrEqual(before - expected);
  expect(result.getTime()).toBeLessThanOrEqual(after - expected);
});

test("parseSince rejects invalid formats", () => {
  expect(() => parseSince("24")).toThrow();
});
