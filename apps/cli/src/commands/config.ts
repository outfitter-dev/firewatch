import {
  PATHS,
  ensureDirectories,
  getConfigPaths,
  getProjectConfigPath,
} from "@outfitter/firewatch-core";
import { Command } from "commander";

export const configCommand = new Command("config").description(
  "Manage Firewatch settings"
);

configCommand
  .command("show")
  .description("Display current configuration")
  .action(async () => {
    try {
      const paths = await getConfigPaths();
      const userFile = Bun.file(paths.user);
      const projectFile = paths.project ? Bun.file(paths.project) : null;

      if (await userFile.exists()) {
        console.log(`# User config (${paths.user})`);
        console.log(await userFile.text());
      } else {
        console.log(`# User config (${paths.user})`);
        console.log("# No configuration file found.");
      }

      if (projectFile) {
        if (await projectFile.exists()) {
          console.log(`\n# Project config (${paths.project})`);
          console.log(await projectFile.text());
        }
      } else {
        const projectPath = await getProjectConfigPath();
        if (projectPath) {
          console.log(`\n# Project config (${projectPath})`);
          console.log("# No project configuration file found.");
        }
      }

      if (!(await userFile.exists()) && !projectFile) {
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
  .argument("<key>", "Configuration key")
  .argument("<value>", "Configuration value")
  .action(async (key: string, value: string, options) => {
    try {
      let configPath: string = PATHS.configFile;
      if (options.local) {
        const projectPath = await getProjectConfigPath();
        if (!projectPath) {
          console.error("No project config path found. Run inside a git repo.");
          process.exit(1);
        }
        configPath = projectPath;
      } else {
        await ensureDirectories();
      }

      // Read existing config or create empty
      const configFile = Bun.file(configPath);
      const config: Record<string, unknown> = {};

      if (await configFile.exists()) {
        const content = await configFile.text();
        // Simple TOML parsing for basic key-value pairs
        for (const line of content.split("\n")) {
          const match = line.match(/^(\w+)\s*=\s*(.+)$/);
          if (match) {
            const [, k, v] = match;
            if (k && v) {
              try {
                config[k] = JSON.parse(v.replaceAll("'", '"'));
              } catch {
                config[k] = v.replaceAll(/^["']|["']$/g, "");
              }
            }
          }
        }
      }

      // Handle special keys
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

      // Write back as TOML
      const lines: string[] = [];
      for (const [k, v] of Object.entries(config)) {
        if (Array.isArray(v)) {
          lines.push(`${k} = ${JSON.stringify(v)}`);
        } else if (typeof v === "boolean") {
          lines.push(`${k} = ${v}`);
        } else if (typeof v === "number") {
          lines.push(`${k} = ${v}`);
        } else {
          lines.push(`${k} = "${v}"`);
        }
      }

      await Bun.write(configPath, `${lines.join("\n")}\n`);
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
  .action(async () => {
    const projectPath = await getProjectConfigPath();
    console.log(`Config:  ${PATHS.configFile}`);
    if (projectPath) {
      console.log(`Project: ${projectPath}`);
    }
    console.log(`Cache:   ${PATHS.cache}`);
    console.log(`Data:    ${PATHS.data}`);
    console.log(`Repos:   ${PATHS.repos}`);
    console.log(`Meta:    ${PATHS.meta}`);
  });
