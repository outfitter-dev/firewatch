import {
  ENTRY_TYPES,
  type EntryType,
  type FirewatchConfig,
  type FirewatchEntry,
  type PrState,
  GitHubClient,
  detectAuth,
  detectRepo,
  ensureDirectories,
  getRepoCachePath,
  loadConfig,
  outputJsonl,
  parseSince,
  queryEntries,
  syncRepo,
} from "@outfitter/firewatch-core";
import {
  getGraphiteStacks,
  graphitePlugin,
} from "@outfitter/firewatch-core/plugins";
import { Command } from "commander";
import ora from "ora";

import { cacheCommand } from "./commands/cache";
import { checkCommand } from "./commands/check";
import { commentCommand } from "./commands/comment";
import { configCommand } from "./commands/config";
import { mcpCommand } from "./commands/mcp";
import { queryCommand } from "./commands/query";
import { recapCommand } from "./commands/recap";
import { resolveCommand } from "./commands/resolve";
import { printSchema, schemaCommand } from "./commands/schema";
import { statusCommand } from "./commands/status";
import { syncCommand } from "./commands/sync";
import { outputStackedEntries } from "./stack";
import { outputWorklist } from "./worklist";

/**
 * Parse comma-separated state values.
 */
function parseStates(value: string): PrState[] {
  return value.split(",").map((s) => s.trim() as PrState);
}

/**
 * Parse and validate comma-separated type values.
 */
function parseTypes(value: string): EntryType[] {
  const types = value.split(",").map((s) => s.trim().toLowerCase());
  const invalid = types.filter((t) => !ENTRY_TYPES.includes(t as EntryType));
  if (invalid.length > 0) {
    console.error(
      `Invalid type(s): ${invalid.join(", ")}. Valid types: ${ENTRY_TYPES.join(", ")}`
    );
    process.exit(1);
  }
  return types as EntryType[];
}

interface RootCommandOptions {
  pr?: number;
  author?: string;
  type?: string;
  state?: string;
  open?: boolean;
  draft?: boolean;
  active?: boolean;
  label?: string;
  since?: string;
  limit?: number;
  stack?: boolean;
  worklist?: boolean;
  schema?: boolean;
}

function resolveRepo(
  repo: string | undefined,
  detected: Awaited<ReturnType<typeof detectRepo>>
): string | null {
  if (repo) {
    return repo;
  }
  if (detected.repo) {
    console.error(`Querying ${detected.repo} (from ${detected.source})`);
    return detected.repo;
  }
  return null;
}

function resolveStates(
  options: RootCommandOptions,
  config: FirewatchConfig
): PrState[] {
  if (options.state) {
    return parseStates(options.state);
  }
  if (options.active) {
    return ["open", "draft"];
  }
  if (options.open && options.draft) {
    return ["open", "draft"];
  }
  if (options.open) {
    return ["open"];
  }
  if (options.draft) {
    return ["draft"];
  }
  return config.default_states ?? ["open", "draft"];
}

async function ensureRepoCache(
  repoFilter: string,
  config: FirewatchConfig,
  detectedRepo: string | null
): Promise<void> {
  const cachePath = getRepoCachePath(repoFilter);
  const cacheFile = Bun.file(cachePath);
  const hasCache = (await cacheFile.exists())
    ? cacheFile.size > 0
    : false;

  if (hasCache) {
    return;
  }

  await ensureDirectories();

  const auth = await detectAuth(config.github_token);
  if (!auth.token) {
    console.error(auth.error);
    process.exit(1);
  }

  const spinner = ora(`Syncing ${repoFilter}...`).start();
  try {
    const client = new GitHubClient(auth.token);
    let graphiteAvailable = false;
    if (!config.graphite_enabled && detectedRepo === repoFilter) {
      graphiteAvailable = (await getGraphiteStacks()) !== null;
    }

    const graphiteEnabled = config.graphite_enabled || graphiteAvailable;
    const plugins =
      graphiteEnabled && detectedRepo === repoFilter ? [graphitePlugin] : [];

    const result = await syncRepo(client, repoFilter, { plugins });
    spinner.succeed(`Synced ${repoFilter} (${result.entriesAdded} entries)`);
  } catch (error) {
    spinner.fail(
      `Sync failed: ${error instanceof Error ? error.message : error}`
    );
    process.exit(1);
  }
}

function buildQueryOptions(
  options: RootCommandOptions,
  config: FirewatchConfig,
  repoFilter: string,
  types?: EntryType[]
) {
  const states = resolveStates(options, config);
  const since = options.since ?? config.default_since;

  return {
    filters: {
      repo: repoFilter,
      ...(options.pr !== undefined && { pr: options.pr }),
      ...(options.author && { author: options.author }),
      ...(types && types.length > 0 && { type: types }),
      ...(states && { states }),
      ...(options.label && { label: options.label }),
      ...(since && { since: parseSince(since) }),
    },
    ...(options.limit !== undefined && { limit: options.limit }),
    plugins: [],
  };
}

async function outputEntries(
  entries: FirewatchEntry[],
  options: RootCommandOptions,
  config: FirewatchConfig
): Promise<void> {
  if (options.worklist) {
    const wrote = await outputWorklist(entries);
    if (!wrote) {
      console.error("No entries found for worklist.");
    }
    return;
  }

  const stackMode = options.stack || config.default_stack;
  if (stackMode) {
    const wrote = await outputStackedEntries(entries);
    if (!wrote) {
      console.error(
        "No Graphite stack data found. Re-sync (graphite auto-detects) or enable graphite in config."
      );
    }
    return;
  }

  outputJsonl(entries);
}

const program = new Command();
program.enablePositionalOptions();

program
  .name("fw")
  .description(
    "GitHub PR activity logger with pure JSONL output for jq-based workflows"
  )
  .version("0.1.0")
  .argument("[repo]", "Repository to query (owner/repo format, or auto-detect)")
  .option("--pr <number>", "Filter by PR number", Number.parseInt)
  .option("--author <name>", "Filter by author")
  .option(
    "--type <type>",
    "Filter by type (comment, review, commit, ci, event)"
  )
  .option(
    "--state <states>",
    "Filter by PR state (comma-separated: open,closed,merged,draft)"
  )
  .option("--open", "Shorthand for --state open")
  .option("--draft", "Shorthand for --state draft")
  .option("--active", "Shorthand for --state open,draft")
  .option("--label <name>", "Filter by PR label (partial match)")
  .option(
    "--since <duration>",
    "Filter by time window. Formats: Nh (hours), Nd (days), Nw (weeks), Nm (months). Examples: 1h, 24h, 7d, 2w, 1m"
  )
  .option("--limit <count>", "Limit number of results", Number.parseInt)
  .option("--stack", "Show entries grouped by Graphite stack")
  .option("--worklist", "Aggregate entries into a per-PR worklist")
  .option("--schema", "Print the query result schema (JSON)")
  .action(async (repo: string | undefined, options: RootCommandOptions) => {
    // Parse and validate --type option (handles comma-separated values)
    const types = options.type ? parseTypes(options.type) : undefined;

    try {
      if (options.schema) {
        printSchema("query");
        return;
      }

      const detected = await detectRepo();
      const repoFilter = resolveRepo(repo, detected);

      if (!repoFilter) {
        console.error(
          "No repository detected. Use: fw org/repo\n" +
            "Or run from within a git repo with a GitHub remote."
        );
        process.exit(1);
      }

      // Load config for defaults
      const config = await loadConfig();
      await ensureRepoCache(repoFilter, config, detected.repo);

      const entries = await queryEntries(
        buildQueryOptions(options, config, repoFilter, types)
      );
      await outputEntries(entries, options, config);
    } catch (error) {
      console.error(
        "Query failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });

program.addCommand(syncCommand);
program.addCommand(checkCommand);
program.addCommand(queryCommand);
program.addCommand(statusCommand);
program.addCommand(recapCommand);
program.addCommand(cacheCommand);
program.addCommand(commentCommand);
program.addCommand(resolveCommand);
program.addCommand(configCommand);
program.addCommand(schemaCommand);
program.addCommand(mcpCommand);

export { program };

export function run(): void {
  program.parse();
}
