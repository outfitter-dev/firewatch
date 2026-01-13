import {
  PATHS,
  ensureDirectories,
  getConfigPaths,
  getProjectConfigPath,
} from "@outfitter/firewatch-core";
import { Command } from "commander";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { writeJsonLine } from "../utils/json";

export const configCommand = new Command("config").description(
  "Manage Firewatch settings"
);

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
  return PATHS.configFile;
}

async function readConfigFile(path: string): Promise<Record<string, unknown>> {
  const configFile = Bun.file(path);
  const config: Record<string, unknown> = {};

  if (await configFile.exists()) {
    const content = await configFile.text();
    for (const line of content.split("\n")) {
      const match = line.match(/^(\w+)\s*=\s*(.+)$/);
      if (!match) {
        continue;
      }
      const [, key, raw] = match;
      if (!key || !raw) {
        continue;
      }
      try {
        config[key] = JSON.parse(raw.replaceAll("'", '"'));
      } catch {
        config[key] = raw.replaceAll(/^["']|["']$/g, "");
      }
    }
  }

  return config;
}

function applyConfigValue(
  config: Record<string, unknown>,
  key: string,
  value: string
): string {
  const normalizedKey = key.replaceAll("-", "_");

  if (normalizedKey === "repos") {
    config.repos = value.split(",").map((r) => r.trim());
  } else if (normalizedKey === "github_token") {
    config.github_token = value;
  } else if (normalizedKey === "graphite_enabled") {
    config.graphite_enabled = value === "true";
  } else if (normalizedKey === "default_stack") {
    config.default_stack = value === "true";
  } else if (normalizedKey === "default_states") {
    config.default_states = value.split(",").map((s) => s.trim());
  } else {
    config[normalizedKey] = value;
  }

  return normalizedKey;
}

function serializeConfig(config: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(config)) {
    if (Array.isArray(value)) {
      lines.push(`${key} = ${JSON.stringify(value)}`);
    } else if (typeof value === "boolean") {
      lines.push(`${key} = ${value}`);
    } else if (typeof value === "number") {
      lines.push(`${key} = ${value}`);
    } else {
      lines.push(`${key} = "${value}"`);
    }
  }

  return `${lines.join("\n")}\n`;
}

configCommand
  .command("show")
  .description("Display current configuration")
  .option("--json", "Output JSON")
  .action(async (options) => {
    try {
      const paths = await getConfigPaths();
      const userFile = Bun.file(paths.user);
      const projectPath = await getProjectConfigPath();
      const projectFile = projectPath ? Bun.file(projectPath) : null;
      const hasUserConfig = await userFile.exists();
      const hasProjectConfig = projectFile ? await projectFile.exists() : false;

      if (options.json) {
        const payload: Record<string, unknown> = {
          user: {
            path: paths.user,
            exists: hasUserConfig,
            content: hasUserConfig ? await userFile.text() : null,
          },
          project: projectPath
            ? {
                path: projectPath,
                exists: hasProjectConfig,
                content:
                  hasProjectConfig && projectFile
                    ? await projectFile.text()
                    : null,
              }
            : null,
        };

        if (!hasUserConfig && !hasProjectConfig) {
          payload.example = {
            repos: ["owner/repo1", "owner/repo2"],
            graphite_enabled: true,
            default_stack: true,
            default_since: "7d",
            default_states: ["open", "draft"],
          };
        }

        await writeJsonLine(payload);
        return;
      }

      if (hasUserConfig) {
        console.log(`# User config (${paths.user})`);
        console.log(await userFile.text());
      } else {
        console.log(`# User config (${paths.user})`);
        console.log("# No configuration file found.");
      }

      if (projectPath) {
        if (hasProjectConfig && projectFile) {
          console.log(`\n# Project config (${projectPath})`);
          console.log(await projectFile.text());
        } else {
          console.log(`\n# Project config (${projectPath})`);
          console.log("# No project configuration file found.");
        }
      }

      if (!hasUserConfig && !hasProjectConfig) {
        console.log("\n# Example config:");
        console.log('# repos = ["owner/repo1", "owner/repo2"]');
        console.log("# graphite_enabled = true");
        console.log("# default_stack = true");
        console.log('# default_since = "7d"');
        console.log('# default_states = ["open", "draft"]');
      }
    } catch (error) {
      console.error(
        "Failed to read config:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });

configCommand
  .command("set")
  .description("Set a configuration value")
  .option("--local", "Write to project config in the repo")
  .option("--json", "Output JSON")
  .argument("<key>", "Configuration key")
  .argument("<value>", "Configuration value")
  .action(async (key: string, value: string, options) => {
    try {
      const configPath = await resolveConfigPath(options.local);
      const config = await readConfigFile(configPath);
      const normalizedKey = applyConfigValue(config, key, value);
      await Bun.write(configPath, serializeConfig(config));
      if (options.json) {
        await writeJsonLine({
          ok: true,
          path: configPath,
          key: normalizedKey,
          value: config[normalizedKey],
          ...(options.local && { local: true }),
        });
        return;
      }

      console.log(`Set ${key} = ${value}`);
    } catch (error) {
      console.error(
        "Failed to set config:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });

configCommand
  .command("path")
  .description("Show configuration file paths")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const projectPath = await getProjectConfigPath();
    if (options.json) {
      await writeJsonLine({
        config: PATHS.configFile,
        project: projectPath,
        cache: PATHS.cache,
        data: PATHS.data,
        repos: PATHS.repos,
        meta: PATHS.meta,
      });
      return;
    }
    console.log(`Config:  ${PATHS.configFile}`);
    if (projectPath) {
      console.log(`Project: ${projectPath}`);
    }
    console.log(`Cache:   ${PATHS.cache}`);
    console.log(`Data:    ${PATHS.data}`);
    console.log(`Repos:   ${PATHS.repos}`);
    console.log(`Meta:    ${PATHS.meta}`);
  });
