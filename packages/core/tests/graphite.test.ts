import { expect, test } from "bun:test";

import { parseGraphiteLog } from "../src/plugins/graphite";

test("parseGraphiteLog builds a stack from gt log output", () => {
  const output = [
    "\u001B[36m\u25C9\u001B[39m feat/top (current) ",
    "\u2502 PR #12 fix: top",
    "\u25EF feat/base",
    "\u2502 PR #11 fix: base",
    "\u25EF main",
  ].join("\n");

  const stacks = parseGraphiteLog(output);
  expect(stacks).toHaveLength(1);
  expect(stacks[0]?.name).toBe("feat/base");
  expect(stacks[0]?.branches.map((branch) => branch.prNumber)).toEqual([
    11,
    12,
  ]);
});
