/**
 * ID Resolver for Firewatch CLI
 *
 * Determines whether an input ID refers to a PR, comment, or review.
 * Provides utilities for short ID generation and formatting.
 */

import { createHash } from "node:crypto";

export type IdType = "pr" | "comment" | "review";

export interface ResolvedId {
  /** The type of ID (pr, comment, or review) */
  type: IdType;
  /** The ID to use with APIs (full ID for comments, number for PRs) */
  id: string;
  /** For comments: the short ID form (5 hex chars, without prefix) */
  shortId?: string;
  /** Original user input */
  raw: string;
}

/** Regex for valid short ID format: exactly 5 hex characters */
const SHORT_ID_PATTERN = /^[0-9a-f]{5}$/i;

/** Regex for short ID with prefix (e.g., `@abc12`) */
const SHORT_ID_INPUT_PATTERN = /^@([0-9a-f]{5})$/i;

/**
 * Resolve an input string to determine its ID type.
 *
 * Detection rules:
 * - Numbers (including 0) -> PR
 * - Short ID with prefix (5 hex chars) -> Comment short ID
 * - PRRC_* -> Comment (pull request review comment)
 * - IC_* -> Comment (issue comment)
 * - PRR_* -> Review (pull request review)
 *
 * @param input - The user input to resolve
 * @returns ResolvedId with type and ID information
 * @throws Error if input cannot be resolved to a known type
 */
export function resolveId(input: string): ResolvedId {
  const trimmed = input.trim();

  // Check for PR number (positive integer or zero)
  if (/^\d+$/.test(trimmed)) {
    return {
      type: "pr",
      id: trimmed,
      raw: input,
    };
  }

  // Check for short ID format: @xxxxx (5 hex chars)
  const shortIdMatch = SHORT_ID_INPUT_PATTERN.exec(trimmed);
  if (shortIdMatch?.[1]) {
    const shortId = shortIdMatch[1].toLowerCase();
    return {
      type: "comment",
      id: "", // Not yet resolved - requires async DB lookup
      shortId,
      raw: input,
    };
  }

  // Check for full comment IDs
  if (trimmed.startsWith("PRRC_") || trimmed.startsWith("IC_")) {
    return {
      type: "comment",
      id: trimmed,
      shortId: generateShortId(trimmed),
      raw: input,
    };
  }

  // Check for review ID
  if (trimmed.startsWith("PRR_")) {
    return {
      type: "review",
      id: trimmed,
      raw: input,
    };
  }

  throw new Error(
    `Invalid ID format: "${input}". Expected a PR number, @shortId, or full ID (PRRC_*, IC_*, PRR_*)`
  );
}

/**
 * Generate a short ID from a full GitHub node ID.
 *
 * Uses SHA256 hash of the full ID, taking the first 5 hex characters.
 * This provides ~1 million unique values, sufficient for local deduplication.
 *
 * @param fullId - The full GitHub node ID (e.g., PRRC_kwDOABC123)
 * @returns 5-character hex string
 */
export function generateShortId(fullId: string): string {
  const hash = createHash("sha256").update(fullId).digest("hex");
  return hash.slice(0, 5).toLowerCase();
}

/**
 * Format a short ID for display.
 *
 * @param shortId - The 5-character hex short ID
 * @returns Formatted string in [@xxxxx] format
 */
export function formatShortId(shortId: string): string {
  return `[@${shortId.toLowerCase()}]`;
}

/**
 * Validate if a string is a valid short ID format.
 *
 * Valid short IDs are exactly 5 hex characters (0-9, a-f).
 * The prefix should NOT be included when calling this function.
 *
 * @param input - The string to validate (without @ prefix)
 * @returns true if valid short ID format
 */
export function isValidShortId(input: string): boolean {
  return SHORT_ID_PATTERN.test(input);
}
