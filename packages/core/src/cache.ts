import envPaths from "env-paths";
import { existsSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";

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

/**
 * Legacy separator used in cache filenames.
 */
export const REPO_SEPARATOR = "--";
const REPO_CACHE_PREFIX = "b64~";

/**
 * Get the cache file path for a repository.
 * @param repo - Repository in owner/repo format
 */
export function getRepoCachePath(repo: string): string {
  const legacyName = repo.replace("/", REPO_SEPARATOR);
  const legacyPath = `${PATHS.repos}/${legacyName}.jsonl`;
  if (existsSync(legacyPath)) {
    return legacyPath;
  }

  const encoded = Buffer.from(repo, "utf8").toString("base64url");
  const safeName = `${REPO_CACHE_PREFIX}${encoded}`;
  return `${PATHS.repos}/${safeName}.jsonl`;
}

/**
 * Parse a cache filename back to owner/repo format.
 * @param filename - Cache filename (without .jsonl extension)
 */
export function parseRepoCacheFilename(filename: string): string {
  if (filename.startsWith(REPO_CACHE_PREFIX)) {
    const encoded = filename.slice(REPO_CACHE_PREFIX.length);
    try {
      const decoded = Buffer.from(encoded, "base64url").toString("utf8");
      if (decoded.includes("/")) {
        return decoded;
      }
    } catch {
      // fall through to legacy format
    }
  }
  return filename.replace(REPO_SEPARATOR, "/");
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
