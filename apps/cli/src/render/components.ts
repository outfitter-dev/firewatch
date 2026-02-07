/**
 * High-level styled components for CLI output.
 *
 * These components combine core render utilities with ANSI styling
 * to produce consistent, visually appealing output.
 */

import {
  BOX,
  SEPARATOR,
  STATUS,
  renderHeader as coreRenderHeader,
  truncate,
} from "@outfitter/firewatch-core";

import { s, type StyleFn } from "./ansi";
import {
  categoryStyle,
  checkColor,
  CATEGORY_LABELS,
  type ActionableCategory,
} from "./theme";

// Re-export SEPARATOR for direct use
export { SEPARATOR };

/** Options for styled header rendering */
export interface StyledHeaderOptions {
  /** Width for separator line */
  width?: number;
  /** Total count to display (e.g., "8 actionable") */
  count?: number;
  /** Count label (default: "actionable") */
  countLabel?: string;
}

/**
 * Render a styled header with optional count.
 *
 * Output:
 * ```
 * Firewatch · owner/repo · 8 actionable
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ```
 */
export function renderStyledHeader(
  parts: string[],
  options: StyledHeaderOptions = {}
): string[] {
  const headerParts = [...parts];

  if (options.count !== undefined && options.count > 0) {
    const label = options.countLabel ?? "actionable";
    headerParts.push(`${options.count} ${label}`);
  }

  const renderOptions =
    options.width === undefined ? undefined : { width: options.width };
  return coreRenderHeader(headerParts, renderOptions);
}

/** Item in an actionable category */
export interface ActionableItem {
  pr: number;
  pr_branch: string;
  pr_title: string;
  description: string;
}

/** Options for category section rendering */
export interface CategorySectionOptions {
  /** Maximum items to show before truncation */
  limit?: number;
  /** Current branch (for highlighting) */
  currentBranch?: string | null;
}

/**
 * Format a category header line.
 *
 * Output: `◆ Unaddressed Feedback (5)`
 */
export function formatCategoryHeader(
  category: ActionableCategory,
  count: number
): string {
  const style = categoryStyle[category];
  const label = CATEGORY_LABELS[category];
  const marker = count > 0 ? STATUS.diamond : STATUS.diamondEmpty;
  return style.color(`${marker} ${label} (${count})`);
}

/**
 * Format a PR line within a category.
 *
 * Output: `├─ #53 [mg/fix-cache] fix: wire cache command...`
 */
export function formatPrLine(
  pr: number,
  branch: string,
  title: string,
  isLast: boolean,
  color: StyleFn
): string {
  const prefix = isLast ? BOX.last : BOX.branch;
  const truncatedTitle = truncate(title, 40);
  return `  ${prefix} ${color(`#${pr}`)} ${s.dim(`[${branch}]`)} ${truncatedTitle}`;
}

/**
 * Format a detail line (author summary, etc).
 *
 * Output: `│     coderabbitai (3), greptile-apps (1)`
 */
export function formatDetailLine(detail: string, isLastPr: boolean): string {
  const prefix = isLastPr ? "   " : `  ${BOX.pipe}`;
  // Format authors with @ prefix
  const formatted = detail.replaceAll(
    /\b([a-zA-Z0-9_-]+) \((\d+)\)/g,
    "@$1 ($2)"
  );
  return `${prefix}  ${s.dim(formatted)}`;
}

/**
 * Render a complete category section.
 *
 * Output:
 * ```
 * ◆ Unaddressed Feedback (5)
 *   ├─ #53 [mg/fix-cache]
 *   │     @coderabbitai (3), @greptile-apps (1)
 *   └─ #44 [mg/orphaned-flag]
 *         @chatgpt-codex (2)
 * ```
 */
export function renderCategorySection(
  category: ActionableCategory,
  items: ActionableItem[],
  options: CategorySectionOptions = {}
): string[] {
  const limit = options.limit ?? 5;
  const style = categoryStyle[category];

  // Header
  const lines: string[] = [formatCategoryHeader(category, items.length)];

  // Items (with limit)
  const visibleItems = items.slice(0, limit);
  const lastVisibleIndex = visibleItems.length - 1;
  const hasMore = items.length > limit;

  for (const [i, item] of visibleItems.entries()) {
    const isLast = i === lastVisibleIndex && !hasMore;

    // PR line with title
    lines.push(
      formatPrLine(item.pr, item.pr_branch, item.pr_title, isLast, style.color)
    );

    // Detail line (if has useful info)
    if (shouldShowDetail(item.description)) {
      lines.push(formatDetailLine(item.description, isLast));
    }
  }

  // Overflow indicator
  if (hasMore) {
    const remaining = items.length - limit;
    lines.push(`  ${BOX.last} ${s.dim(`+${remaining} more`)}`);
  }

  return lines;
}

/**
 * Check if detail line should be shown.
 * Skip generic status messages that don't add useful info.
 */
function shouldShowDetail(description: string): boolean {
  const genericMessages = [
    "Awaiting first review",
    "No recent activity",
    "Changes requested",
  ];
  return !genericMessages.includes(description);
}

/**
 * Format a check result for doctor command.
 *
 * Output: `✓ Auth valid: user via gh-cli`
 *    or: `✗ Auth valid: No token found`
 *         `  Run \`gh auth login\` to authenticate.`
 */
export function formatCheckResult(
  name: string,
  ok: boolean,
  message?: string,
  hint?: string
): string[] {
  const color = checkColor(ok);
  const marker = ok ? STATUS.check : STATUS.cross;
  const detail = message ? `: ${message}` : "";
  const lines = [color(`${marker} ${name}${detail}`)];

  if (!ok && hint) {
    lines.push(`  ${hint}`);
  }

  return lines;
}

/**
 * Render feedback item for fb command.
 *
 * Output:
 * ```
 * [@a1b2] @coderabbit src/file.ts:42
 *   "Review comment preview text..."
 * ```
 */
export function formatFeedbackItem(
  shortId: string,
  author: string,
  location: string,
  bodyPreview?: string
): string {
  const lines = [`${s.cyan(shortId)} ${s.dim(`@${author}`)} ${location}`];
  if (bodyPreview) {
    lines.push(`  ${s.dim(`"${bodyPreview}"`)}`);
  }
  return lines.join("\n");
}

/**
 * Render PR feedback summary header.
 *
 * Output:
 * ```
 * PR #53: fix: wire cache command...
 * ──────────────────────────────────
 * ```
 */
export function formatPrFeedbackHeader(
  pr: number,
  title: string,
  width = 50
): string[] {
  const truncatedTitle = truncate(title, width - 10);
  return [`\nPR #${pr}: ${truncatedTitle}`, SEPARATOR.tertiary.repeat(width)];
}
