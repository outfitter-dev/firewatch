import {
  getDatabase,
  loadConfig,
  statusHandler,
  type StatusOutput,
} from "@outfitter/firewatch-core";
import { silentLogger } from "@outfitter/firewatch-shared";
import { Command, Option } from "commander";

import { version } from "../../package.json";
import { applyCommonOptions } from "../query-helpers";
import { s } from "../render";
import { outputStructured } from "../utils/json";
import { formatRelativeTime, shouldOutputJson } from "../utils/tty";

interface StatusCommandOptions {
  short?: boolean;
  jsonl?: boolean;
  json?: boolean;
  debug?: boolean;
  noColor?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAuthLabel(
  authLogin: string | undefined,
  authToken: boolean,
  authSource: string
): string {
  if (authLogin) {
    return `${authLogin} (${authSource})`;
  }
  if (authToken) {
    return `token (${authSource})`;
  }
  return "unauthenticated";
}

function printShortOutput(output: StatusOutput): void {
  const authColor = output.auth.ok ? s.green : s.yellow;
  const authLabel = formatAuthLabel(
    output.auth.username,
    output.auth.ok,
    output.auth.source
  );
  const repoLabel = output.repo.name ?? s.dim("none");
  const cacheLabel = `${output.cache.repos} repos, ${output.cache.entries} entries`;
  const lastSync = output.cache.last_sync
    ? `, last sync ${formatRelativeTime(output.cache.last_sync)}`
    : "";
  console.log(
    `${s.bold("Firewatch")} v${output.version} | auth=${authColor(authLabel)} | repo=${repoLabel} | cache=${cacheLabel}${lastSync}`
  );
}

function printFullOutput(output: StatusOutput): void {
  console.log(`${s.bold("Firewatch")} v${output.version}\n`);
  const authColor = output.auth.ok ? s.green : s.yellow;
  const authLine = formatAuthLabel(
    output.auth.username,
    output.auth.ok,
    `via ${output.auth.source}`
  );
  console.log(`${s.dim("Auth:")}      ${authColor(authLine)}`);

  const configLine = [
    output.config.project ? `${output.config.project.path} (project)` : null,
    `${output.config.user.path} (user)`,
  ]
    .filter(Boolean)
    .join(" + ");
  console.log(`${s.dim("Config:")}    ${configLine}`);
  const repoLabel = output.repo.name ?? s.dim("none");
  const repoSource = output.repo.source
    ? s.dim(` (${output.repo.source})`)
    : "";
  console.log(`${s.dim("Repo:")}      ${repoLabel}${repoSource}`);
  const graphiteLabel = output.graphite.available
    ? s.green("enabled")
    : s.dim("disabled");
  console.log(`${s.dim("Graphite:")}  ${graphiteLabel}`);

  console.log(`\n${s.dim("Cache:")}`);
  console.log(`  ${s.dim("Repos:")}     ${output.cache.repos}`);
  console.log(`  ${s.dim("Entries:")}   ${output.cache.entries}`);
  if (output.cache.last_sync) {
    console.log(
      `  ${s.dim("Last sync:")} ${formatRelativeTime(output.cache.last_sync)}`
    );
  }
  if (output.cache.size_bytes !== undefined) {
    console.log(
      `  ${s.dim("Size:")}      ${formatBytes(output.cache.size_bytes)}`
    );
  }
}

export const statusCommand = new Command("status")
  .description("Show Firewatch state information")
  .option("--short", "Compact single-line output")
  .option("--jsonl", "Force structured output")
  .option("--no-jsonl", "Force human-readable output")
  .addOption(new Option("--json").hideHelp())
  .option("--debug", "Enable debug logging")
  .option("--no-color", "Disable color output")
  .action(async (options: StatusCommandOptions) => {
    applyCommonOptions(options);
    try {
      const config = await loadConfig();
      const db = getDatabase();
      const outputJson = shouldOutputJson(
        options,
        config.output?.default_format
      );

      const result = await statusHandler(
        { version },
        { config, db, logger: silentLogger }
      );

      if (result.isErr()) {
        console.error("Status failed:", result.error.message);
        process.exit(1);
      }

      const output = result.value;

      if (outputJson) {
        await outputStructured(output, "jsonl");
        return;
      }

      if (options.short) {
        printShortOutput(output);
        return;
      }

      printFullOutput(output);
    } catch (error) {
      console.error(
        "Status failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
