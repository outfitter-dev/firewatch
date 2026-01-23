/**
 * Viewport detection for terminal-aware rendering.
 */

import type { OutputTarget, Viewport } from "./types";

const DEFAULT_WIDTH = 80;
const MIN_WIDTH = 40;
const MAX_WIDTH = 200;

/**
 * Detect the current terminal viewport.
 * Returns a sensible default if not in a TTY.
 */
export function detectViewport(): Viewport {
  const columns = process.stdout.columns;

  if (!columns || !process.stdout.isTTY) {
    return { width: DEFAULT_WIDTH };
  }

  const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, columns));
  const height = process.stdout.rows;

  return { width, ...(height && { height }) };
}

/**
 * Detect the output target type.
 */
export function detectOutputTarget(): OutputTarget {
  if (!process.stdout.isTTY) {
    return "pipe";
  }
  return "tty";
}

/**
 * Check if output is to a TTY (supports colors, cursor movement, etc.)
 */
export function isTTY(): boolean {
  return process.stdout.isTTY === true;
}
