/**
 * TTY detection and output mode utilities
 *
 * Determines output format (JSON vs human-readable) based on:
 * 1. Explicit --json/--no-json flags
 * 2. FIREWATCH_JSON environment variable
 * 3. TTY detection (non-TTY defaults to JSON for piping)
 */

export interface OutputModeOptions {
  json?: boolean;
  noJson?: boolean;
}

/**
 * Determine if output should be JSON based on:
 * 1. --json flag (explicit)
 * 2. FIREWATCH_JSON env var
 * 3. TTY detection (non-TTY defaults to JSON)
 */
export function shouldOutputJson(options: OutputModeOptions): boolean {
  // Explicit flag takes precedence
  if (options.json === true) {
    return true;
  }
  if (options.noJson === true) {
    return false;
  }

  // Environment variable
  if (process.env.FIREWATCH_JSON === "1") {
    return true;
  }
  if (process.env.FIREWATCH_JSON === "0") {
    return false;
  }

  // TTY detection - if not a TTY (piped), default to JSON
  if (!process.stdout.isTTY) {
    return true;
  }

  // Interactive terminal - default to human-readable
  return false;
}

/**
 * Determine if color should be used.
 * Respects NO_COLOR, FORCE_COLOR, and TERM=dumb conventions.
 */
export function shouldUseColor(): boolean {
  if (process.env.NO_COLOR) {
    return false;
  }
  if (process.env.FORCE_COLOR) {
    return true;
  }
  if (process.env.TERM === "dumb") {
    return false;
  }
  return process.stdout.isTTY ?? false;
}

// Simple ANSI color helpers (no dependencies)
const wrap =
  (open: string, close: string) =>
  (text: string): string =>
    shouldUseColor() ? `${open}${text}${close}` : text;

const RESET = "\u001B[0m";

export const colors = {
  green: wrap("\u001B[32m", RESET),
  yellow: wrap("\u001B[33m", RESET),
  red: wrap("\u001B[31m", RESET),
  cyan: wrap("\u001B[36m", RESET),
  blue: wrap("\u001B[34m", RESET),
  magenta: wrap("\u001B[35m", RESET),
  dim: wrap("\u001B[2m", RESET),
  bold: wrap("\u001B[1m", RESET),
};

/**
 * State color mapping for PR states
 */
export function getStateColor(
  state: string
): (text: string) => string {
  switch (state.toLowerCase()) {
    case "open":
      return colors.green;
    case "draft":
      return colors.yellow;
    case "merged":
      return colors.cyan;
    case "closed":
      return colors.dim;
    default:
      return (s: string) => s;
  }
}

/**
 * Status color mapping for CI status
 */
export function getStatusColor(
  status: string
): (text: string) => string {
  switch (status.toLowerCase()) {
    case "success":
      return colors.green;
    case "failure":
      return colors.red;
    default:
      return colors.yellow;
  }
}

/**
 * Truncate and pad text for table alignment
 */
export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text;
  }
  return `${text.slice(0, maxLen - 1)}\u2026`;
}

/**
 * Format a relative time string from ISO date
 */
export function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) {
    return "just now";
  }
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  if (diffDays < 30) {
    return `${Math.floor(diffDays / 7)}w ago`;
  }
  return `${Math.floor(diffDays / 30)}mo ago`;
}
