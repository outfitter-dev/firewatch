import { Command } from "commander";

import { version } from "../package.json";
import { ackCommand } from "./commands/ack";
import { cacheCommand } from "./commands/cache";
import { claudePluginCommand } from "./commands/claude-plugin";
import { closeCommand } from "./commands/close";
import { configCommand } from "./commands/config";
import { doctorCommand } from "./commands/doctor";
import { examplesCommand } from "./commands/examples";
import { fbCommand } from "./commands/fb";
import { mcpCommand } from "./commands/mcp";
import { prCommand } from "./commands/pr";
import { executeCliQuery } from "./query";
import {
  applyGlobalOptions,
  type QueryCommandOptions,
} from "./query-helpers";
import { schemaCommand } from "./commands/schema";
import { statusCommand } from "./commands/status";

const program = new Command();
program.enablePositionalOptions();

program
  .name("fw")
  .description(
    "GitHub PR activity logger with pure JSONL output for jq-based workflows"
  )
  .version(version)
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
  .option("--offline", "Use cache only, no network")
  .option("--refresh [full]", "Force sync before query")
  .option("-n, --limit <count>", "Limit number of results", Number.parseInt)
  .option("--offset <count>", "Skip first N results", Number.parseInt)
  .option("--summary", "Aggregate entries into per-PR summary")
  .option("-j, --jsonl", "Force structured output")
  .option("--no-jsonl", "Force human-readable output")
  .option("--debug", "Enable debug logging")
  .option("--no-color", "Disable color output")
  .addHelpText(
    "after",
    `
Examples:
  fw --summary                    Per-PR rollup
  fw --type comment --since 24h   Recent comments
  fw --mine                       Activity on my PRs
  fw examples                     Common jq patterns (escaping tips)`
  )
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

program.addCommand(prCommand);
program.addCommand(ackCommand);
program.addCommand(closeCommand);
program.addCommand(fbCommand);
program.addCommand(cacheCommand);
program.addCommand(claudePluginCommand);
program.addCommand(statusCommand);
program.addCommand(configCommand);
program.addCommand(doctorCommand);
program.addCommand(schemaCommand);
program.addCommand(examplesCommand);
program.addCommand(mcpCommand);

// Explicit help command since root action intercepts unknown args
program
  .command("help")
  .description("Display help for fw")
  .action(() => {
    program.help();
  });

export { program };

export function run(): void {
  program.parse();
}
