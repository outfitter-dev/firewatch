/**
 * Shared rendering utilities for consistent CLI output.
 *
 * This module provides:
 * - Viewport detection for terminal-aware rendering
 * - Text utilities (truncation, wrapping)
 * - Tree rendering for hierarchical data
 * - Consistent glyph usage
 * - ID formatting with [@id] convention
 *
 * @example
 * import { formatDisplayId, renderTree, truncate } from "@outfitter/firewatch-core";
 *
 * const id = formatDisplayId("a1b2"); // "[@a1b2]"
 * const text = truncate("Long title here", 20);
 * const tree = renderTree([{ content: "Item 1" }, { content: "Item 2" }]);
 */

// Types
export type {
  HeaderLevel,
  OutputTarget,
  TreeNode,
  TreeOptions,
  Viewport,
} from "./types";

// Viewport detection
export { detectOutputTarget, detectViewport, isTTY } from "./viewport";

// Text utilities
export {
  normalizeWhitespace,
  padEnd,
  padStart,
  truncate,
  wrapText,
} from "./text";

// Glyphs
export { BOX, CATEGORY, CONTINUATION, SEPARATOR, STATUS } from "./glyphs";

// Tree rendering
export {
  renderCategory,
  renderDivider,
  renderHeader,
  renderTree,
} from "./tree";

// ID formatting
export { formatDisplayId, isDisplayId, parseDisplayId } from "./ids";
