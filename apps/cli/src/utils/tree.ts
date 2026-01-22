/**
 * Tree-drawing utilities for CLI output formatting.
 *
 * Provides box-drawing characters and functions for rendering
 * hierarchical data as visually connected trees.
 */

/** Box-drawing characters for tree structure */
export const BOX = {
  branch: "├─",
  last: "└─",
  pipe: "│",
  empty: "  ",
} as const;

/** Category and status markers */
export const MARKERS = {
  filled: "◆", // has items
  empty: "◇", // no items / informational
  pass: "✓",
  fail: "✗",
} as const;

export interface TreeNode {
  content: string;
  detail?: string; // secondary line (e.g., authors)
  children?: TreeNode[];
}

export interface TreeOptions {
  indent?: number; // spaces before tree, default 2
}

/**
 * Render a list of nodes as tree branches.
 */
export function renderTree(
  nodes: TreeNode[],
  options: TreeOptions = {}
): string[] {
  const indent = " ".repeat(options.indent ?? 2);
  const lines: string[] = [];
  const lastIndex = nodes.length - 1;

  for (const [i, node] of nodes.entries()) {
    const isLast = i === lastIndex;
    const prefix = isLast ? BOX.last : BOX.branch;
    const continuation = isLast ? BOX.empty : `${BOX.pipe} `;

    lines.push(`${indent}${prefix} ${node.content}`);

    if (node.detail) {
      lines.push(`${indent}${continuation} ${node.detail}`);
    }

    if (node.children && node.children.length > 0) {
      const childLines = renderTree(node.children, { indent: 0 });
      for (const childLine of childLines) {
        lines.push(`${indent}${continuation}${childLine}`);
      }
    }
  }

  return lines;
}

/**
 * Render a category section with header and items.
 */
export function renderCategory(
  label: string,
  count: number,
  items: TreeNode[],
  hasItems = true
): string[] {
  const marker = hasItems && items.length > 0 ? MARKERS.filled : MARKERS.empty;
  const lines: string[] = [`${marker} ${label} (${count})`];

  if (items.length > 0) {
    lines.push(...renderTree(items));
  }

  return lines;
}

/**
 * Render a header with separator line.
 */
export function renderHeader(parts: string[], width?: number): string[] {
  const headerText = parts.filter(Boolean).join(" · ");
  const separatorWidth = width ?? headerText.length;
  const separator = "━".repeat(separatorWidth);

  return [headerText, separator];
}

/**
 * Truncate a string to a maximum length with ellipsis.
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return `${str.slice(0, maxLength - 1)}\u2026`;
}
