import { PATHS } from "./cache";
import {
  DEFAULT_CONFIG,
  type FirewatchConfig,
  FirewatchConfigSchema,
} from "./schema/config";

const PROJECT_CONFIG_FILENAME = ".firewatch.toml";

// --------------------------------------------------------------------------
// Environment variable overrides
// --------------------------------------------------------------------------

type EnvParser<T> = (value: string) => T;

const parseEnvBoolean: EnvParser<boolean> = (value) => {
  const lower = value.toLowerCase();
  return lower === "true" || lower === "1";
};

const parseEnvInteger: EnvParser<number> = (value) => {
  const num = Number.parseInt(value, 10);
  if (Number.isNaN(num)) {
    throw new TypeError(`Invalid integer value: ${value}`);
  }
  return num;
};

const parseEnvString: EnvParser<string> = (value) => value;

const parseEnvCommaSeparated: EnvParser<string[]> = (value) => {
  if (!value.trim()) {
    return [];
  }
  return value.split(",").map((s) => s.trim());
};

interface EnvMapping {
  path: string[];
  parse: EnvParser<unknown>;
}

/**
 * Mapping of environment variable names to config paths and parsers.
 *
 * Naming convention: FIREWATCH_{SECTION}_{KEY} (all uppercase, underscores)
 *
 * Precedence (highest to lowest):
 * 1. Environment variables
 * 2. Project config (.firewatch.toml)
 * 3. User config (~/.config/firewatch/config.toml)
 * 4. Schema defaults
 */
const ENV_MAP: Record<string, EnvMapping> = {
  // Top-level config
  FIREWATCH_GITHUB_TOKEN: { path: ["github_token"], parse: parseEnvString },
  FIREWATCH_REPOS: { path: ["repos"], parse: parseEnvCommaSeparated },
  FIREWATCH_MAX_PRS_PER_SYNC: {
    path: ["max_prs_per_sync"],
    parse: parseEnvInteger,
  },

  // Sync section
  FIREWATCH_SYNC_AUTO_SYNC: {
    path: ["sync", "auto_sync"],
    parse: parseEnvBoolean,
  },
  FIREWATCH_SYNC_STALE_THRESHOLD: {
    path: ["sync", "stale_threshold"],
    parse: parseEnvString,
  },

  // Output section
  FIREWATCH_OUTPUT_DEFAULT_FORMAT: {
    path: ["output", "default_format"],
    parse: parseEnvString,
  },

  // User section
  FIREWATCH_USER_GITHUB_USERNAME: {
    path: ["user", "github_username"],
    parse: parseEnvString,
  },

  // Filters section
  FIREWATCH_FILTERS_EXCLUDE_BOTS: {
    path: ["filters", "exclude_bots"],
    parse: parseEnvBoolean,
  },
  FIREWATCH_FILTERS_EXCLUDE_AUTHORS: {
    path: ["filters", "exclude_authors"],
    parse: parseEnvCommaSeparated,
  },
  FIREWATCH_FILTERS_BOT_PATTERNS: {
    path: ["filters", "bot_patterns"],
    parse: parseEnvCommaSeparated,
  },

  // Feedback section
  FIREWATCH_FEEDBACK_COMMIT_IMPLIES_READ: {
    path: ["feedback", "commit_implies_read"],
    parse: parseEnvBoolean,
  },
};

/**
 * Apply environment variable overrides to config.
 * Env vars take precedence over file-based config.
 */
export function applyEnvOverrides(
  config: Record<string, unknown>
): Record<string, unknown> {
  for (const [envKey, { path, parse }] of Object.entries(ENV_MAP)) {
    const value = process.env[envKey];
    if (value !== undefined) {
      try {
        setNestedValue(config, path, parse(value));
      } catch {
        // Skip invalid env values silently - let Zod validation catch type errors
      }
    }
  }
  return config;
}

interface ConfigPaths {
  user: string;
  project?: string;
}

/**
 * Load configuration from the config file.
 * Returns merged config from user + project config files.
 */
export async function loadConfig(
  options: { cwd?: string; strict?: boolean } = {}
): Promise<FirewatchConfig> {
  const cwd = options.cwd ?? process.cwd();
  const paths = await getConfigPaths(cwd);
  const userConfig = await readConfigFile(paths.user);
  const projectConfig = paths.project
    ? await readConfigFile(paths.project)
    : null;

  const merged = mergeConfig(userConfig ?? {}, projectConfig ?? {});
  const withEnv = applyEnvOverrides(merged as Record<string, unknown>);

  try {
    return FirewatchConfigSchema.parse(withEnv);
  } catch (error) {
    if (options.strict) {
      throw error;
    }
    console.error(
      "Warning: Failed to parse config file, using defaults:",
      error instanceof Error ? error.message : error
    );
    return DEFAULT_CONFIG;
  }
}

/**
 * Simple TOML parser for flat config files.
 * Handles basic key = value pairs and arrays.
 */
function parseTOML(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split("\n");
  let currentSection: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (trimmed.startsWith("#") || trimmed === "") {
      continue;
    }

    const withoutComment = stripInlineComment(trimmed);
    if (!withoutComment) {
      continue;
    }

    // Section header
    if (withoutComment.startsWith("[") && withoutComment.endsWith("]")) {
      const name = withoutComment.slice(1, -1).trim();
      if (!name) {
        continue;
      }
      currentSection = name
        .split(".")
        .map((part) => part.trim())
        .filter(Boolean);
      ensureNestedObject(result, currentSection);
      continue;
    }

    // Parse key = value
    const match = withoutComment.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (!key || !rawValue) {
      continue;
    }

    const path = [
      ...currentSection,
      ...key.split(".").map((part) => part.trim()),
    ].filter(Boolean);
    if (path.length === 0) {
      continue;
    }

    setNestedValue(result, path, parseValue(rawValue.trim()));
  }

  return result;
}

async function readConfigFile(
  path: string
): Promise<Record<string, unknown> | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return null;
  }

  const text = await file.text();
  return parseTOML(text);
}

function mergeConfig(
  userConfig: Record<string, unknown>,
  projectConfig: Record<string, unknown>
): FirewatchConfig {
  let merged: Record<string, unknown> = { ...DEFAULT_CONFIG };
  merged = mergeDeep(merged, userConfig);
  merged = mergeDeep(merged, projectConfig);
  return merged as FirewatchConfig;
}

function splitArrayValues(inner: string): string[] {
  const items: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";
  let escapeNext = false;

  for (const char of inner) {
    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      current += char;
      escapeNext = true;
      continue;
    }

    if ((char === '"' || char === "'") && !inQuote) {
      inQuote = true;
      quoteChar = char;
      current += char;
      continue;
    }

    if (inQuote && char === quoteChar) {
      inQuote = false;
      current += char;
      continue;
    }

    if (char === "," && !inQuote) {
      const value = current.trim();
      if (value) {
        items.push(value);
      }
      current = "";
      continue;
    }

    current += char;
  }

  const value = current.trim();
  if (value) {
    items.push(value);
  }

  return items;
}

async function findFileUp(
  filename: string,
  startDir: string
): Promise<string | null> {
  let dir = startDir;
  const root = "/";

  while (dir !== root) {
    const filePath = `${dir}/${filename}`;
    const file = Bun.file(filePath);
    if (await file.exists()) {
      return filePath;
    }
    dir = dir.slice(0, dir.lastIndexOf("/")) || root;
  }

  return null;
}

async function findGitRoot(startDir: string): Promise<string | null> {
  let dir = startDir;
  const root = "/";

  while (dir !== root) {
    const gitPath = `${dir}/.git`;
    const gitEntry = Bun.file(gitPath);
    if (await gitEntry.exists()) {
      return dir;
    }
    dir = dir.slice(0, dir.lastIndexOf("/")) || root;
  }

  return null;
}

export async function getProjectConfigPath(
  cwd: string = process.cwd()
): Promise<string | null> {
  const gitRoot = await findGitRoot(cwd);
  if (gitRoot) {
    return `${gitRoot}/${PROJECT_CONFIG_FILENAME}`;
  }

  return await findFileUp(PROJECT_CONFIG_FILENAME, cwd);
}

export async function findProjectConfigPath(
  cwd: string = process.cwd()
): Promise<string | null> {
  const path = await getProjectConfigPath(cwd);
  if (!path) {
    return null;
  }

  const file = Bun.file(path);
  return (await file.exists()) ? path : null;
}

export async function getConfigPaths(
  cwd: string = process.cwd()
): Promise<ConfigPaths> {
  const project = await findProjectConfigPath(cwd);
  return {
    user: PATHS.configFile,
    ...(project && { project }),
  };
}

/**
 * Parse a TOML value.
 */
function parseValue(value: string): unknown {
  // Boolean
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }

  // Number
  if (/^-?\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  if (/^-?\d+\.\d+$/.test(value)) {
    return Number.parseFloat(value);
  }

  // String (quoted)
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  // Array
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (inner === "") {
      return [];
    }
    const items = splitArrayValues(inner).map((item) =>
      parseValue(item.trim())
    );
    return items;
  }

  // Bare string
  return value;
}

function stripInlineComment(value: string): string {
  let inQuote = false;
  let quoteChar = "";
  let escapeNext = false;

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]!;

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if ((char === '"' || char === "'") && !inQuote) {
      inQuote = true;
      quoteChar = char;
      continue;
    }

    if (inQuote && char === quoteChar) {
      inQuote = false;
      continue;
    }

    if (!inQuote && char === "#") {
      return value.slice(0, i).trim();
    }
  }

  return value.trim();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureNestedObject(
  target: Record<string, unknown>,
  path: string[]
): void {
  let cursor: Record<string, unknown> = target;
  for (const key of path) {
    const existing = cursor[key];
    if (isPlainObject(existing)) {
      cursor = existing;
      continue;
    }
    const next: Record<string, unknown> = {};
    cursor[key] = next;
    cursor = next;
  }
}

function setNestedValue(
  target: Record<string, unknown>,
  path: string[],
  value: unknown
): void {
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < path.length; i += 1) {
    const key = path[i];
    if (!key) {
      continue;
    }
    if (i === path.length - 1) {
      cursor[key] = value;
      return;
    }
    const existing = cursor[key];
    if (isPlainObject(existing)) {
      cursor = existing;
      continue;
    }
    const next: Record<string, unknown> = {};
    cursor[key] = next;
    cursor = next;
  }
}

function mergeDeep(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) {
      continue;
    }
    const existing = result[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = mergeDeep(existing, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function serializeValue(value: unknown): string {
  if (Array.isArray(value)) {
    const items = value.map((item) => serializeValue(item));
    return `[${items.join(", ")}]`;
  }
  if (typeof value === "string") {
    return `"${value}"`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) {
    return "null";
  }
  return `"${String(value)}"`;
}

function serializeObject(
  section: Record<string, unknown>,
  prefix: string[] = []
): string[] {
  const lines: string[] = [];
  const entries = Object.entries(section);

  const scalarEntries = entries.filter(([, value]) => !isPlainObject(value));
  const objectEntries = entries.filter(([, value]) => isPlainObject(value));

  for (const [key, value] of scalarEntries) {
    lines.push(`${key} = ${serializeValue(value)}`);
  }

  for (const [key, value] of objectEntries) {
    if (!isPlainObject(value)) {
      continue;
    }
    const nextPrefix = [...prefix, key];
    lines.push("");
    lines.push(`[${nextPrefix.join(".")}]`);
    lines.push(...serializeObject(value, nextPrefix));
  }

  return lines;
}

export function parseConfigText(text: string): Record<string, unknown> {
  return parseTOML(text);
}

export function serializeConfigObject(config: Record<string, unknown>): string {
  const lines = [
    "# Firewatch configuration",
    "",
    ...serializeObject(config),
    "",
  ];
  return lines.join("\n");
}

/**
 * Save configuration to the config file.
 * If the config contains a github_token, the file is set to mode 0600 for security.
 */
export async function saveConfig(config: FirewatchConfig): Promise<void> {
  const content = serializeConfigObject(config as Record<string, unknown>);
  await Bun.write(PATHS.configFile, content);

  // Secure file permissions if it contains a token
  if (config.github_token) {
    const { chmod } = await import("node:fs/promises");
    await chmod(PATHS.configFile, 0o600);
  }
}
