/**
 * Text manipulation utilities for rendering.
 */

/**
 * Truncate a string to a maximum length with ellipsis.
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return `${str.slice(0, maxLength - 1)}\u2026`;
}

/**
 * Wrap text to fit within a given width, preserving word boundaries.
 */
export function wrapText(text: string, width: number): string[] {
  if (text.length <= width) {
    return [text];
  }

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (currentLine.length === 0) {
      currentLine = word;
    } else if (currentLine.length + 1 + word.length <= width) {
      currentLine += ` ${word}`;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Normalize whitespace in a string (collapse newlines, trim).
 */
export function normalizeWhitespace(str: string): string {
  return str.replaceAll(/\s+/g, " ").trim();
}

/**
 * Pad a string to a minimum length.
 */
export function padEnd(str: string, length: number, char = " "): string {
  if (str.length >= length) {
    return str;
  }
  return str + char.repeat(length - str.length);
}

/**
 * Pad a string to a minimum length (left side).
 */
export function padStart(str: string, length: number, char = " "): string {
  if (str.length >= length) {
    return str;
  }
  return char.repeat(length - str.length) + str;
}
