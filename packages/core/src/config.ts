import { PATHS } from "./cache";
import {
  DEFAULT_CONFIG,
  type FirewatchConfig,
  FirewatchConfigSchema,
} from "./schema/config";

const PROJECT_CONFIG_FILENAME = ".firewatch.toml";

interface ConfigPaths {
  user: string;
  project?: string;
}

/**
 * Load configuration from the config file.
 * Returns merged config from user + project config files.
 */
export async function loadConfig(options: { cwd?: string } = {}): Promise<FirewatchConfig> {
  const cwd = options.cwd ?? process.cwd();
  const paths = await getConfigPaths(cwd);
  const userConfig = await readConfigFile(paths.user);
  const projectConfig = paths.project
    ? await readConfigFile(paths.project)
    : null;

  const merged = mergeConfig(userConfig ?? {}, projectConfig ?? {});

  try {
    return FirewatchConfigSchema.parse(merged);
  } catch (error) {
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

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (trimmed.startsWith("#") || trimmed === "") {
      continue;
    }

    // Parse key = value
    const match = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (!key || !rawValue) {
      continue;
    }

    result[key] = parseValue(rawValue.trim());
  }

  return result;
}

async function readConfigFile(path: string): Promise<Record<string, unknown> | null> {
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
  const merged: Record<string, unknown> = { ...DEFAULT_CONFIG };
  for (const [key, value] of Object.entries(userConfig)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  for (const [key, value] of Object.entries(projectConfig)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged as FirewatchConfig;
}

function splitArrayValues(inner: string): string[] {
  const items: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (const char of inner) {
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
    const items = splitArrayValues(inner).map((item) => parseValue(item.trim()));
    return items;
  }

  // Bare string
  return value;
}

/**
 * Save configuration to the config file.
 */
export async function saveConfig(config: FirewatchConfig): Promise<void> {
  const lines: string[] = ["# Firewatch configuration", ""];

  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      const items = value.map((v) =>
        typeof v === "string" ? `"${v}"` : String(v)
      );
      lines.push(`${key} = [${items.join(", ")}]`);
    } else if (typeof value === "string") {
      lines.push(`${key} = "${value}"`);
    } else {
      lines.push(`${key} = ${value}`);
    }
  }

  lines.push("");
  await Bun.write(PATHS.configFile, lines.join("\n"));
}
