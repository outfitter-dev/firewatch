import {
  type EntryType,
  type FirewatchConfig,
  detectRepo,
  loadConfig,
  parseSince,
  queryEntries,
} from "@outfitter/firewatch-core";
import { Command } from "commander";

import { outputEntries } from "../utils/output";
import { resolveStates } from "../utils/states";

interface QueryCommandOptions {
  repo?: string;
  all?: boolean;
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
  offset?: number;
  stack?: boolean;
  worklist?: boolean;
  json?: boolean;
}

function buildQueryOptions(
  options: QueryCommandOptions,
  config: FirewatchConfig
) {
  const states = resolveStates(options, config);
  const since = options.since ?? config.default_since;

  return {
    filters: {
      ...(options.repo && { repo: options.repo }),
      ...(options.pr !== undefined && { pr: options.pr }),
      ...(options.author && { author: options.author }),
      ...(options.type && { type: options.type as EntryType }),
      ...(states && { states }),
      ...(options.label && { label: options.label }),
      ...(since && { since: parseSince(since) }),
    },
    ...(options.limit !== undefined && { limit: options.limit }),
    ...(options.offset !== undefined && { offset: options.offset }),
    plugins: [], // TODO: Load plugins for custom filters
  };
}

export const queryCommand = new Command("query")
  .description("Filter and output JSONL to stdout")
  .option("--repo <name>", "Filter by repository (partial match)")
  .option("--all", "Query across all cached repos")
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
  .option("--since <duration>", "Filter by time (e.g., 24h, 7d)")
  .option("--limit <count>", "Limit number of results", Number.parseInt)
  .option("--offset <count>", "Skip first N results", Number.parseInt)
  .option("--stack", "Show entries grouped by Graphite stack")
  .option("--worklist", "Aggregate entries into a per-PR worklist")
  .option("--json", "Output JSONL (default)")
  .action(async (options: QueryCommandOptions) => {
    try {
      let repoFilter = options.repo;
      if (!repoFilter && !options.all) {
        const detected = await detectRepo();
        if (detected.repo) {
          console.error(`Querying ${detected.repo} (from ${detected.source})`);
          repoFilter = detected.repo;
        }
      }

      // Load config for defaults
      const config = await loadConfig();

      const resolvedOptions = repoFilter
        ? { ...options, repo: repoFilter }
        : options;

      const entries = await queryEntries(
        buildQueryOptions(resolvedOptions, config)
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
