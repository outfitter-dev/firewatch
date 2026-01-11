import { Command } from "commander";

import {
  type EntryType,
  outputJsonl,
  parseSince,
  queryEntries,
} from "../../core";

export const queryCommand = new Command("query")
  .description("Filter and output JSONL to stdout")
  .option("--repo <name>", "Filter by repository (partial match)")
  .option("--pr <number>", "Filter by PR number", Number.parseInt)
  .option("--author <name>", "Filter by author")
  .option(
    "--type <type>",
    "Filter by type (comment, review, commit, ci, event)"
  )
  .option("--since <duration>", "Filter by time (e.g., 24h, 7d)")
  .option("--limit <count>", "Limit number of results", Number.parseInt)
  .option("--offset <count>", "Skip first N results", Number.parseInt)
  .option("--stack", "Show entries grouped by Graphite stack")
  .action(async (options) => {
    try {
      const entries = await queryEntries({
        filters: {
          ...(options.repo && { repo: options.repo }),
          ...(options.pr !== undefined && { pr: options.pr }),
          ...(options.author && { author: options.author }),
          ...(options.type && { type: options.type as EntryType }),
          ...(options.since && { since: parseSince(options.since) }),
        },
        ...(options.limit !== undefined && { limit: options.limit }),
        ...(options.offset !== undefined && { offset: options.offset }),
        plugins: [], // TODO: Load plugins for custom filters
      });

      outputJsonl(entries);
    } catch (error) {
      console.error(
        "Query failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
