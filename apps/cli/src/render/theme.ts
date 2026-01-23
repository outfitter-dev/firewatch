/**
 * Semantic color and glyph mappings for CLI output.
 *
 * Maps domain concepts (categories, states, statuses) to visual styles.
 */

import { CATEGORY, STATUS } from "@outfitter/firewatch-core";

import { s, type StyleFn } from "./ansi";

/** Actionable category type */
export type ActionableCategory =
  | "unaddressed"
  | "changes_requested"
  | "awaiting_review"
  | "stale";

/** Labels for actionable categories */
export const CATEGORY_LABELS: Record<ActionableCategory, string> = {
  unaddressed: "Unaddressed Feedback",
  changes_requested: "Changes Requested",
  awaiting_review: "Awaiting Review",
  stale: "Stale",
};

/** Display order for categories (priority order) */
export const CATEGORY_ORDER: ActionableCategory[] = [
  "unaddressed",
  "changes_requested",
  "awaiting_review",
  "stale",
];

/** Category-specific styling */
export interface CategoryStyle {
  color: StyleFn;
  glyph: { current: string; other: string };
}

/** Style mappings for each category */
export const categoryStyle: Record<ActionableCategory, CategoryStyle> = {
  unaddressed: { color: s.yellow, glyph: CATEGORY.unaddressed },
  changes_requested: { color: s.white, glyph: CATEGORY.changes_requested },
  awaiting_review: { color: s.cyan, glyph: CATEGORY.awaiting_review },
  stale: { color: s.dim, glyph: CATEGORY.stale },
};

/**
 * Get style function for a PR state.
 */
export function stateColor(state: string): StyleFn {
  switch (state.toLowerCase()) {
    case "open":
      return s.green;
    case "draft":
      return s.yellow;
    case "merged":
      return s.cyan;
    case "closed":
      return s.dim;
    default:
      return (text: string) => text;
  }
}

/**
 * Get style function for a CI status.
 */
export function statusColor(status: string): StyleFn {
  switch (status.toLowerCase()) {
    case "success":
      return s.green;
    case "failure":
      return s.red;
    default:
      return s.yellow;
  }
}

/**
 * Get style function for a check result (pass/fail).
 */
export function checkColor(ok: boolean): StyleFn {
  return ok ? s.green : s.red;
}

/** Styled status markers */
export const markers = {
  pass: () => s.green(STATUS.check),
  fail: () => s.red(STATUS.cross),
  warning: () => s.yellow(STATUS.warning),
} as const;
