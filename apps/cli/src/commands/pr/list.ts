import { Command, Option } from "commander";

import { executeCliQuery } from "../../query";
import {
  applyGlobalOptions,
  type QueryCommandOptions,
} from "../../query-helpers";

export const listCommand = new Command("list")
  .description("List PRs and activity (default: current repo)")
  .option("--pr [numbers]", "Filter to PR domain, optionally specific PRs")
  .option("--repo <name>", "Filter to specific repository")
  .option("--all", "Include all cached repos")
  .option("--mine", "Items on PRs assigned to me")
  .option("--reviews", "PRs I need to review")
  .option("--open", "Filter to open PRs")
  .option("--closed", "Include merged and closed PRs")
  .option("--draft", "Filter to draft PRs")
  .option("--active", "Alias for --open --draft")
  .option("--orphaned", "Unresolved review comments on merged/closed PRs")
  .option("--state <states>", "Explicit comma-separated PR states")
  .option(
    "--type <types>",
    "Filter by entry type (comment, review, commit, ci, event)"
  )
  .option("--label <name>", "Filter by PR label (partial match)")
  .option("--author <list>", "Filter by author(s), prefix with ! to exclude")
  .option("--no-bots", "Exclude bot activity")
  .option(
    "-s, --since <duration>",
    "Filter by time window. Formats: Nh, Nd, Nw, Nm (months). Examples: 24h, 7d"
  )
  .option("--before <date>", "Entries created before ISO date (e.g., 2024-01-15)")
  .option("--refresh [full]", "Force sync before query")
  .option("-n, --limit <count>", "Limit number of results", Number.parseInt)
  .option("--offset <count>", "Skip first N results", Number.parseInt)
  .option("--summary", "Aggregate entries into per-PR summary")
  .option("-j, --jsonl", "Force structured output")
  .option("--no-jsonl", "Force human-readable output")
  .addOption(new Option("--json").hideHelp())
  .option("--debug", "Enable debug logging")
  .option("--no-color", "Disable color output")
  .action(async (options: QueryCommandOptions) => {
    applyGlobalOptions(options);

    try {
      await executeCliQuery(options);
    } catch (error) {
      console.error(
        "Query failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
