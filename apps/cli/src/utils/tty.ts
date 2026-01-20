/**
 * TTY detection and output mode utilities
 *
 * Determines output format (structured vs human-readable) based on:
 * 1. Explicit --jsonl/--no-jsonl flags
 * 2. FIREWATCH_JSONL (preferred) or FIREWATCH_JSON environment variable
 * 3. TTY detection (non-TTY defaults to JSON for piping)
 */

export interface OutputModeOptions {
  jsonl?: boolean;
  json?: boolean;
}

/**
 * Determine if output should be structured based on:
 * 1. --jsonl/--no-jsonl flags (explicit)
 * 2. FIREWATCH_JSONL (preferred) or FIREWATCH_JSON env var
 * 3. TTY detection (non-TTY defaults to JSON)
 *
 * Note: Commander's --no-jsonl sets options.jsonl = false (not noJsonl = true)
 */
export function shouldOutputJson(
  options: OutputModeOptions,
  defaultFormat?: "human" | "json"
): boolean {
  // Explicit flag takes precedence
  // --jsonl sets jsonl=true, --no-jsonl sets jsonl=false
  if (options.jsonl === true) {
    return true;
  }
  if (options.jsonl === false) {
    return false;
  }
  if (options.json === true) {
    return true;
  }
  if (options.json === false) {
    return false;
  }

  // Environment variable (prefer JSONL)
  if (process.env.FIREWATCH_JSONL === "1") {
    return true;
  }
  if (process.env.FIREWATCH_JSONL === "0") {
    return false;
  }
  if (process.env.FIREWATCH_JSON === "1") {
    return true;
  }
  if (process.env.FIREWATCH_JSON === "0") {
    return false;
  }

  if (defaultFormat === "json") {
    return true;
  }
  if (defaultFormat === "human") {
    return false;
  }

  // TTY detection - if not a TTY (piped), default to JSON
  if (!process.stdout.isTTY) {
    return true;
  }

  // Interactive terminal - default to human-readable
  return false;
}

// Re-export color utilities from centralized color module
export {
  c as colors,
  getAnsis,
  getStateColor,
  getStatusColor,
  resetColorInstance,
} from "./color";

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
