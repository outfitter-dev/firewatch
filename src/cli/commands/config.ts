import { Command } from "commander";

import { PATHS, ensureDirectories } from "../../core";

export const configCommand = new Command("config").description(
  "Manage Firewatch settings"
);

configCommand
  .command("show")
  .description("Display current configuration")
  .action(async () => {
    try {
      const configFile = Bun.file(PATHS.configFile);
      if (await configFile.exists()) {
        const content = await configFile.text();
        console.log(content);
      } else {
        console.log("# No configuration file found.");
        console.log(`# Create one at: ${PATHS.configFile}`);
        console.log("#");
        console.log("# Example config:");
        console.log('# repos = ["owner/repo1", "owner/repo2"]');
        console.log("# graphite_enabled = true");
        console.log('# default_since = "7d"');
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
  .argument("<key>", "Configuration key")
  .argument("<value>", "Configuration value")
  .action(async (key: string, value: string) => {
    try {
      await ensureDirectories();

      // Read existing config or create empty
      const configFile = Bun.file(PATHS.configFile);
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

      await Bun.write(PATHS.configFile, `${lines.join("\n")}\n`);
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
  .action(() => {
    console.log(`Config:  ${PATHS.configFile}`);
    console.log(`Cache:   ${PATHS.cache}`);
    console.log(`Data:    ${PATHS.data}`);
    console.log(`Repos:   ${PATHS.repos}`);
    console.log(`Meta:    ${PATHS.meta}`);
  });
