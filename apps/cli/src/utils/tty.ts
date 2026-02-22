/**
 * TTY detection and output mode utilities
 *
 * Determines output format (structured vs human-readable) based on:
 * 1. Explicit --jsonl/--no-jsonl flags
 * 2. Environment variables: OUTFITTER_JSON (set by --json via createCLI),
 *    FIREWATCH_JSONL, FIREWATCH_JSON
 * 3. TTY detection (non-TTY defaults to JSON for piping)
 */

export interface OutputModeOptions {
  jsonl?: boolean;
  json?: boolean;
}

/**
 * Determine if output should be structured based on:
 * 1. --jsonl/--no-jsonl flags (explicit)
 * 2. --json flag (only when explicitly true, not default false)
 * 3. OUTFITTER_JSON (set by createCLI --json), FIREWATCH_JSONL, FIREWATCH_JSON
 * 4. TTY detection (non-TTY defaults to JSON)
 *
 * Note: createCLI defines --json with default false, so options.json is always
 * false when not passed. We only check for options.json === true (explicitly
 * passed) and never treat false as "explicitly disabled". The --no-jsonl flag
 * is the way to explicitly disable structured output.
 *
 * Commander's --no-jsonl sets options.jsonl = false (not noJsonl = true)
 */
export function shouldOutputJson(
  options: OutputModeOptions,
  defaultFormat?: "human" | "json"
): boolean {
  // Explicit --jsonl/--no-jsonl flags take precedence
  if (options.jsonl === true) {
    return true;
  }
  if (options.jsonl === false) {
    return false;
  }

  // --json flag (only truthy check — false may be createCLI's default)
  if (options.json === true) {
    return true;
  }

  // Environment variables
  // OUTFITTER_JSON is set by createCLI's --json preAction hook
  if (process.env.OUTFITTER_JSON === "1") {
    return true;
  }
  if (process.env.OUTFITTER_JSON === "0") {
    return false;
  }
  // Firewatch-specific env vars (legacy, still supported)
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

// Re-export color utilities from render module
export {
  s as colors,
  resetColorCache,
  stateColor,
  statusColor,
} from "../render";

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
