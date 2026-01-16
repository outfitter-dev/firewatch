import type { Database } from "bun:sqlite";
import envPaths from "env-paths";
import { mkdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";

import { closeDatabase, openDatabase } from "./db";

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

  /** SQLite database file */
  db: `${paths.cache}/firewatch.db`,

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

// --- Database Singleton ---

/**
 * Singleton database instance.
 * Lazily initialized on first access.
 */
let _db: Database | null = null;

/**
 * Gets the shared database instance.
 * Creates and initializes the database if not already open.
 *
 * @returns The shared Database instance
 */
export function getDatabase(): Database {
  if (!_db) {
    // Ensure cache directory exists before opening database
    mkdirSync(PATHS.cache, { recursive: true });
    _db = openDatabase(PATHS.db);
  }
  return _db;
}

/**
 * Closes the shared database connection.
 * Safe to call even if database is not open.
 * Should be called during application shutdown.
 */
export function closeFirewatchDb(): void {
  if (_db) {
    closeDatabase(_db);
    _db = null;
  }
}
