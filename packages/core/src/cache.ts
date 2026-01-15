import envPaths from "env-paths";
import { appendFile, mkdir } from "node:fs/promises";
import type { FirewatchEntry } from "./schema";

const paths = envPaths("firewatch", { suffix: "" });

/**
 * XDG-compliant paths for Firewatch data.
 */
export const PATHS = {
  /** Cache directory (~/.cache/firewatch) */
  cache: paths.cache,

  /** Config directory (~/.config/firewatch) */
  config: paths.config,

  /** Data directory (~/.local/share/firewatch) */
  data: paths.data,

  /** Repository cache files */
  repos: `${paths.cache}/repos`,

  /** Sync metadata file */
  meta: `${paths.cache}/meta.jsonl`,

  /** Config file */
  configFile: `${paths.config}/config.toml`,
} as const;

/**
 * Ensure all required directories exist.
 */
export async function ensureDirectories(): Promise<void> {
  await Promise.all([
    mkdir(PATHS.cache, { recursive: true }),
    mkdir(PATHS.config, { recursive: true }),
    mkdir(PATHS.data, { recursive: true }),
    mkdir(PATHS.repos, { recursive: true }),
  ]);
}

const REPO_CACHE_PREFIX = "b64~";

/**
 * Get the cache file path for a repository.
 * @param repo - Repository in owner/repo format
 */
export function getRepoCachePath(repo: string): string {
  const encoded = Buffer.from(repo, "utf8").toString("base64url");
  const safeName = `${REPO_CACHE_PREFIX}${encoded}`;
  return `${PATHS.repos}/${safeName}.jsonl`;
}

/**
 * Parse a cache filename back to owner/repo format.
 * @param filename - Cache filename (without .jsonl extension)
 */
export function parseRepoCacheFilename(filename: string): string | null {
  if (!filename.startsWith(REPO_CACHE_PREFIX)) {
    return null;
  }

  const encoded = filename.slice(REPO_CACHE_PREFIX.length);
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    // Validate: must contain slash (owner/repo) and no null bytes (path safety)
    return decoded.includes("/") && !decoded.includes("\0") ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Append a line to a JSONL file.
 * @param path - File path
 * @param data - Data to serialize and append
 */
export async function appendJsonl<T>(path: string, data: T): Promise<void> {
  const line = `${JSON.stringify(data)}\n`;
  await appendFile(path, line);
}

/**
 * Read all lines from a JSONL file.
 * @param path - File path
 * @returns Array of parsed objects
 */
export async function readJsonl<T>(path: string): Promise<T[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return [];
  }

  const text = await file.text();
  return text
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

/**
 * Write multiple lines to a JSONL file (overwrites existing).
 * @param path - File path
 * @param data - Array of data to serialize
 */
export async function writeJsonl<T>(path: string, data: T[]): Promise<void> {
  const content = `${data.map((item) => JSON.stringify(item)).join("\n")}\n`;
  await Bun.write(path, content);
}

/**
 * Deduplicate entries by ID, keeping the entry with the latest captured_at timestamp.
 * This handles the case where the same entry is appended multiple times during syncs.
 * @param entries - Array of entries that may contain duplicates
 * @returns Array of unique entries with the latest captured_at for each ID
 */
export function deduplicateEntries(entries: FirewatchEntry[]): FirewatchEntry[] {
  const byId = new Map<string, FirewatchEntry>();
  for (const entry of entries) {
    const existing = byId.get(entry.id);
    if (!existing || entry.captured_at > existing.captured_at) {
      byId.set(entry.id, entry);
    }
  }
  return [...byId.values()];
}

/**
 * Read entries from a JSONL cache file, deduplicating by ID.
 * Keeps entries with the latest captured_at timestamp when duplicates exist.
 * @param path - File path to the cache
 * @returns Array of unique entries
 */
export async function readEntriesJsonl(path: string): Promise<FirewatchEntry[]> {
  const entries = await readJsonl<FirewatchEntry>(path);
  return deduplicateEntries(entries);
}
