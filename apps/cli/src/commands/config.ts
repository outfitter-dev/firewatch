import {
  ensureDirectories,
  getConfigPaths,
  getProjectConfigPath,
  loadConfig,
  parseConfigText,
  serializeConfigObject,
} from "@outfitter/firewatch-core";
import { Command, Option } from "commander";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { outputStructured } from "../utils/json";
import { shouldOutputJson } from "../utils/tty";

interface ConfigCommandOptions {
  edit?: boolean;
  path?: boolean;
  local?: boolean;
  jsonl?: boolean;
  json?: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function getNestedValue(
  target: Record<string, unknown>,
  path: string[]
): unknown {
  let cursor: Record<string, unknown> | undefined = target;
  for (const key of path) {
    if (!cursor || !key) {
      return undefined;
    }
    const next: unknown = cursor[key];
    if (!isPlainObject(next)) {
      return next;
    }
    cursor = next;
  }
  return cursor;
}

function parseCliValue(key: string, raw: string): unknown {
  const normalizedKey = key.trim();
  const arrayKeys = new Set([
    "repos",
    "filters.exclude_authors",
    "filters.bot_patterns",
  ]);

  if (
    arrayKeys.has(normalizedKey) &&
    raw.includes(",") &&
    !raw.trim().startsWith("[")
  ) {
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  try {
    const parsed = parseConfigText(`value = ${raw}`);
    if ("value" in parsed) {
      return parsed.value;
    }
  } catch {
    // Fall through to return raw value
  }
  return raw;
}

async function resolveConfigPath(local?: boolean): Promise<string> {
  if (local) {
    const projectPath = await getProjectConfigPath();
    if (!projectPath) {
      throw new Error("No project config path found. Run inside a git repo.");
    }
    await mkdir(dirname(projectPath), { recursive: true });
    return projectPath;
  }

  await ensureDirectories();
  const paths = await getConfigPaths();
  return paths.user;
}

async function readConfigFile(path: string): Promise<Record<string, unknown>> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return {};
  }
  const text = await file.text();
  return parseConfigText(text);
}

async function openEditor(path: string): Promise<void> {
  const editor = process.env.EDITOR ?? "vi";
  const parts = editor.split(" ").filter(Boolean);
  if (parts.length === 0) {
    throw new Error("No editor configured.");
  }
  const proc = Bun.spawn({
    cmd: [...parts, path],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;
}

export const configCommand = new Command("config")
  .description("View and edit configuration")
  .argument("[key]", "Configuration key (dot-separated)")
  .argument("[value]", "New value for key")
  .option("--edit", "Open config in $EDITOR")
  .option("--path", "Show config file path")
  .option("--local", "Target project config (.firewatch.toml)")
  .option("--jsonl", "Force structured output")
  .option("--no-jsonl", "Force human-readable output")
  .addOption(new Option("--json").hideHelp())
  .action(
    async (
      key: string | undefined,
      value: string | undefined,
      options: ConfigCommandOptions
    ) => {
      try {
        if (options.path) {
          const paths = await getConfigPaths();
          const projectPath = await getProjectConfigPath();
          const payload = {
            config: paths.user,
            ...(projectPath && { project: projectPath }),
          };

          if (shouldOutputJson(options)) {
            await outputStructured(payload, "jsonl");
          } else {
            console.log(`Config:  ${paths.user}`);
            if (projectPath) {
              console.log(`Project: ${projectPath}`);
            }
          }
          return;
        }

        if (options.edit) {
          const targetPath = await resolveConfigPath(options.local);
          await openEditor(targetPath);
          return;
        }

        if (!key) {
          const config = await loadConfig();
          if (shouldOutputJson(options, config.output?.default_format)) {
            await outputStructured(config, "jsonl");
          } else {
            console.log(
              serializeConfigObject(config as Record<string, unknown>)
            );
          }
          return;
        }

        if (!value) {
          const config = await loadConfig();
          const outputJson = shouldOutputJson(
            options,
            config.output?.default_format
          );
          const path = key
            .split(".")
            .map((part) => part.trim())
            .filter(Boolean);
          const resolved = getNestedValue(
            config as Record<string, unknown>,
            path
          );
          if (outputJson) {
            await outputStructured({ key, value: resolved ?? null }, "jsonl");
          } else {
            console.log(resolved ?? "");
          }
          return;
        }

        const targetPath = await resolveConfigPath(options.local);
        const configFile = await readConfigFile(targetPath);
        const path = key
          .split(".")
          .map((part) => part.trim())
          .filter(Boolean);
        const parsedValue = parseCliValue(key, value);
        setNestedValue(configFile, path, parsedValue);
        await Bun.write(targetPath, serializeConfigObject(configFile));

        if (shouldOutputJson(options)) {
          await outputStructured(
            {
              ok: true,
              path: targetPath,
              key,
              value: parsedValue,
              ...(options.local && { local: true }),
            },
            "jsonl"
          );
        } else {
          console.log(`Set ${key} = ${value}`);
        }
      } catch (error) {
        console.error(
          "Config failed:",
          error instanceof Error ? error.message : error
        );
        process.exit(1);
      }
    }
  );
