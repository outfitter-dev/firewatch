/**
 * CLI render module - styled output for terminal display.
 *
 * This module wraps the core render utilities with ANSI styling
 * to produce colorful, consistent CLI output.
 *
 * Architecture:
 * - Core render module (packages/core/src/render/) provides text-only utilities
 * - CLI render module adds ANSI colors and styled components
 * - MCP can use core utilities directly without terminal dependencies
 *
 * @example
 * import { s, renderStyledHeader, categoryStyle } from "./render";
 *
 * console.log(s.bold("Title"));
 * console.log(renderStyledHeader(["Firewatch", "owner/repo"], { count: 5 }));
 */

// Core utilities (re-exported for convenience)
export {
  BOX,
  CATEGORY,
  CONTINUATION,
  SEPARATOR,
  STATUS,
  formatDisplayId,
  renderCategory,
  renderDivider,
  renderHeader,
  renderTree,
  truncate,
  type TreeNode,
  type TreeOptions,
} from "@outfitter/firewatch-core";

// ANSI styling
export { resetColorCache, s, useColor, type StyleFn } from "./ansi";

// Semantic theme
export {
  categoryStyle,
  checkColor,
  markers,
  stateColor,
  statusColor,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type ActionableCategory,
  type CategoryStyle,
} from "./theme";

// Styled components
export {
  formatCategoryHeader,
  formatCheckResult,
  formatDetailLine,
  formatFeedbackItem,
  formatPrFeedbackHeader,
  formatPrLine,
  renderCategorySection,
  renderStyledHeader,
  type ActionableItem,
  type CategorySectionOptions,
  type StyledHeaderOptions,
} from "./components";
