/**
 * Tree rendering for hierarchical data.
 */

import { BOX, SEPARATOR, STATUS } from "./glyphs";
import type { HeaderLevel, TreeNode, TreeOptions, Viewport } from "./types";

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
  const marker =
    hasItems && items.length > 0 ? STATUS.diamond : STATUS.diamondEmpty;
  const lines: string[] = [`${marker} ${label} (${count})`];

  if (items.length > 0) {
    lines.push(...renderTree(items));
  }

  return lines;
}

/**
 * Get separator character for a header level.
 */
function getSeparator(level: HeaderLevel): string {
  switch (level) {
    case "primary":
      return SEPARATOR.primary;
    case "secondary":
      return SEPARATOR.secondary;
    case "tertiary":
      return SEPARATOR.tertiary;
  }
}

/**
 * Render a header with separator line.
 */
export function renderHeader(
  parts: string[],
  options?: { width?: number; level?: HeaderLevel; viewport?: Viewport }
): string[] {
  const headerText = parts.filter(Boolean).join(" · ");
  const level = options?.level ?? "secondary";
  const separatorChar = getSeparator(level);

  // Use viewport width if available, otherwise specified width, otherwise header length
  const width =
    options?.viewport?.width ??
    options?.width ??
    Math.max(headerText.length, 50);
  const separator = separatorChar.repeat(
    Math.min(width, headerText.length + 10)
  );

  return [headerText, separator];
}

/**
 * Render a section divider.
 */
export function renderDivider(
  width: number,
  level: HeaderLevel = "tertiary"
): string {
  const char = getSeparator(level);
  return char.repeat(width);
}
