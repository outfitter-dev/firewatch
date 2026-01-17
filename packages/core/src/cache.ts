import type { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";

import { closeDatabase, openDatabase } from "./db";

/**
 * Resolve paths with platform-aware strategy:
 * 1. If XDG env vars are set, use them (respects user intent on any platform)
 * 2. Windows: use AppData paths (LocalAppData for cache, AppData for config/data)
 * 3. macOS without XDG: use ~/.firewatch/ (simple dotfile convention)
 * 4. Linux/other: use XDG defaults (~/.config, ~/.cache, ~/.local/share)
 */
function resolvePaths(): { cache: string; config: string; data: string } {
  const home = homedir();
  const platform = process.platform;

  // Check if user has XDG configured
  const hasXdg =
    process.env.XDG_CONFIG_HOME ||
    process.env.XDG_CACHE_HOME ||
    process.env.XDG_DATA_HOME;

  // XDG takes priority on any platform when explicitly set
  if (hasXdg) {
    const config = process.env.XDG_CONFIG_HOME || `${home}/.config`;
    const cache = process.env.XDG_CACHE_HOME || `${home}/.cache`;
    const data = process.env.XDG_DATA_HOME || `${home}/.local/share`;

    return {
      config: `${config}/firewatch`,
      cache: `${cache}/firewatch`,
      data: `${data}/firewatch`,
    };
  }

  // Windows: use AppData paths
  if (platform === "win32") {
    const appData = process.env.APPDATA || `${home}/AppData/Roaming`;
    const localAppData =
      process.env.LOCALAPPDATA || `${home}/AppData/Local`;

    return {
      config: `${appData}/firewatch`,
      cache: `${localAppData}/firewatch`,
      data: `${appData}/firewatch`,
    };
  }

  // macOS without XDG: use ~/.firewatch/
  if (platform === "darwin") {
    const base = `${home}/.firewatch`;
    return {
      config: base,
      cache: base,
      data: base,
    };
  }

  // Linux/other: XDG defaults
  return {
    config: `${home}/.config/firewatch`,
    cache: `${home}/.cache/firewatch`,
    data: `${home}/.local/share/firewatch`,
  };
}

const paths = resolvePaths();

/**
 * Firewatch data paths.
 * - Respects XDG env vars when set (any platform)
 * - Windows: AppData/Roaming and AppData/Local
 * - macOS without XDG: ~/.firewatch/
 * - Linux: XDG defaults (~/.config, ~/.cache, ~/.local/share)
 */
export const PATHS = {
  /** Cache directory */
  cache: paths.cache,

  /** Config directory */
  config: paths.config,

  /** Data directory */
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
