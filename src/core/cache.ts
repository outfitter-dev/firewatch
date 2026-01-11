import envPaths from "env-paths";
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
 * Get the cache file path for a repository.
 * @param repo - Repository in owner/repo format
 */
export function getRepoCachePath(repo: string): string {
  const safeName = repo.replace("/", "-");
  return `${PATHS.repos}/${safeName}.jsonl`;
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
