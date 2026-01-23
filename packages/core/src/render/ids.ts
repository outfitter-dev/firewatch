/**
 * ID formatting for consistent display.
 *
 * Firewatch uses short IDs (4-5 hex chars) for user-facing references.
 * The `[@id]` format provides visual distinction in CLI output.
 */

/**
 * Format a short ID with brackets for display.
 *
 * @example
 * formatDisplayId("a1b2") // "[@a1b2]"
 * formatDisplayId("A1B2") // "[@a1b2]" (lowercase)
 */
export function formatDisplayId(shortId: string): string {
  return `[@${shortId.toLowerCase()}]`;
}

/**
 * Parse a display ID back to the raw short ID.
 *
 * @example
 * parseDisplayId("[@a1b2]") // "a1b2"
 * parseDisplayId("@a1b2")   // "a1b2"
 * parseDisplayId("a1b2")    // "a1b2"
 */
export function parseDisplayId(displayId: string): string {
  // Handle [@id], @id, and bare id formats
  const match = displayId.match(/^\[?@?([a-f0-9]+)\]?$/i);
  return match?.[1]?.toLowerCase() ?? displayId.toLowerCase();
}

/**
 * Check if a string looks like a display ID.
 */
export function isDisplayId(str: string): boolean {
  return /^\[@[a-f0-9]{4,5}\]$/i.test(str);
}
