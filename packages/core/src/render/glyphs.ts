/**
 * Consistent glyph usage across CLI output.
 *
 * These glyphs provide visual structure and status indicators.
 */

/** Box-drawing characters for tree structure */
export const BOX = {
  /** Branch connector (├─) */
  branch: "├─",
  /** Last item connector (└─) */
  last: "└─",
  /** Vertical continuation (│) */
  pipe: "│",
  /** Empty space for alignment */
  empty: "  ",
  /** Throughline for stack visualization */
  throughline: "│",
} as const;

/** Status markers */
export const STATUS = {
  /** Filled circle - has items / active */
  filled: "●",
  /** Empty circle - no items / inactive */
  empty: "○",
  /** Filled diamond - category with items */
  diamond: "◆",
  /** Empty diamond - category without items */
  diamondEmpty: "◇",
  /** Check mark - success / complete */
  check: "✓",
  /** Cross mark - failure / error */
  cross: "✗",
  /** Warning indicator */
  warning: "⚠",
} as const;

/** Category-specific glyphs for actionable items */
export const CATEGORY = {
  unaddressed: { current: "◉", other: "◎" },
  changes_requested: { current: "◉", other: "◎" },
  awaiting_review: { current: "◯", other: "◯" },
  stale: { current: "◌", other: "◌" },
} as const;

/** Header separators by level */
export const SEPARATOR = {
  /** Primary header (═) - double line */
  primary: "═",
  /** Secondary header (━) - thick line */
  secondary: "━",
  /** Tertiary header (─) - thin line */
  tertiary: "─",
} as const;

/** Continuation glyph for wrapped lines */
export const CONTINUATION = "⎿";
