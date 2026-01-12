import {
  type EntryType,
  type FirewatchConfig,
  type FirewatchEntry,
  type PrState,
  loadConfig,
  outputJsonl,
  parseSince,
  queryEntries,
} from "@outfitter/firewatch-core";
import { Command } from "commander";

import { outputStackedEntries } from "../stack";
import { outputWorklist } from "../worklist";

/**
 * Parse comma-separated state values.
 */
function parseStates(value: string): PrState[] {
  return value.split(",").map((s) => s.trim() as PrState);
}

interface QueryCommandOptions {
  repo?: string;
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
}

function resolveStates(
  options: QueryCommandOptions,
  config: FirewatchConfig
): PrState[] | undefined {
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

async function outputEntries(
  entries: FirewatchEntry[],
  options: QueryCommandOptions,
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

export const queryCommand = new Command("query")
  .description("Filter and output JSONL to stdout")
  .option("--repo <name>", "Filter by repository (partial match)")
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
  .action(async (options: QueryCommandOptions) => {
    try {
      // Load config for defaults
      const config = await loadConfig();

      const entries = await queryEntries(buildQueryOptions(options, config));
      await outputEntries(entries, options, config);
    } catch (error) {
      console.error(
        "Query failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
