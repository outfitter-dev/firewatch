/**
 * Tree-drawing utilities for CLI output formatting.
 *
 * Re-exports from firewatch-core for consistency.
 */

export {
  BOX,
  CATEGORY,
  CONTINUATION,
  SEPARATOR,
  STATUS,
  renderCategory,
  renderHeader,
  renderTree,
  truncate,
  type TreeNode,
  type TreeOptions,
} from "@outfitter/firewatch-core";

// Legacy aliases for backward compatibility
export const MARKERS = {
  filled: "◆",
  empty: "◇",
  pass: "✓",
  fail: "✗",
} as const;
