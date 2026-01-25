import { Command, Option } from "commander";

import { version } from "../package.json";
import { ackCommand } from "./commands/ack";
import { approveCommand } from "./commands/approve";
import { claudePluginCommand } from "./commands/claude-plugin";
import {
  closeAction,
  closeCommand,
  type CloseCommandOptions,
} from "./commands/close";
import { commentCommand } from "./commands/comment";
import { configCommand } from "./commands/config";
import { doctorCommand } from "./commands/doctor";
import { editCommand } from "./commands/edit";
import { examplesCommand } from "./commands/examples";
import { replyCommand } from "./commands/reply";
import { listCommand } from "./commands/list";
import { mcpCommand } from "./commands/mcp";
import { rejectCommand } from "./commands/reject";
import { viewCommand } from "./commands/view";
import { queryCommand } from "./commands/query";
import { schemaCommand } from "./commands/schema";
import { statusCommand } from "./commands/status";
import { syncCommand } from "./commands/sync";
import { executeCliQuery } from "./query";
import {
  applyGlobalOptions,
  type QueryCommandOptions,
  validateLimit,
  validateRepoSlug,
} from "./query-helpers";
import { emitAliasHint } from "./utils/alias-hint";

const program = new Command();
program.enablePositionalOptions();
program.showSuggestionAfterError(true);

program
  .name("fw")
  .description(
    "GitHub PR activity logger with pure JSONL output for jq-based workflows"
  )
  .version(version)
  .option("--pr [numbers]", "Filter to PR domain, optionally specific PRs")
  .option("--repo <name>", "Filter to specific repository", validateRepoSlug)
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
  .option("--exclude-author <list>", "Exclude author(s) (comma-separated)")
  .option("--no-bots", "Exclude bot activity")
  .option(
    "-s, --since <duration>",
    "Filter by time window. Formats: Nh, Nd, Nw, Nm (months). Examples: 24h, 7d"
  )
  .option("--before <date>", "Entries created before ISO date (e.g., 2024-01-15)")
  .option("-n, --limit <count>", "Limit number of results", validateLimit)
  .option("--offset <count>", "Skip first N results", Number.parseInt)
  .option("--summary", "Aggregate entries into per-PR summary")
  .option("-j, --jsonl", "Force structured output")
  .option("--no-jsonl", "Force human-readable output")
  .addOption(new Option("--json").hideHelp())
  .option("--debug", "Enable debug logging")
  .option("--no-color", "Disable color output")
  .addHelpText(
    "after",
    `
Examples:
  fw list                       What needs my attention
  fw list prs --mine            My open PRs
  fw query --type comment       Raw comment data (JSONL)
  fw view @abc12                View comment with context
  fw reply @abc12 "Fixed"       Reply to feedback
  fw close @abc12               Resolve thread
  fw approve 42                 Approve PR
  fw sync                       Refresh cache

Global options like --no-color and --debug apply to all subcommands.
Query options on root 'fw' are supported but 'fw query' is preferred.`
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

program.addCommand(queryCommand);
program.addCommand(syncCommand);
program.addCommand(editCommand);
program.addCommand(ackCommand);
program.addCommand(closeCommand);
program.addCommand(commentCommand);
program.addCommand(approveCommand);
program.addCommand(rejectCommand);

// Hidden alias: `fw resolve` -> `fw close`
const resolveCommand = new Command("resolve")
  .description("Resolve feedback: alias for close")
  .argument("[ids...]", "Comment IDs (short or full) or PR numbers")
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("-a, --all", "Close all unaddressed feedback")
  .option("-y, --yes", "Auto-confirm bulk operations")
  .option("--jsonl", "Force structured output")
  .option("--no-jsonl", "Force human-readable output")
  .addOption(new Option("--json").hideHelp())
  .action((ids: string[], options: CloseCommandOptions) => {
    emitAliasHint("fw resolve", "fw close");
    return closeAction(ids, options);
  });
program.addCommand(resolveCommand, { hidden: true });

program.addCommand(replyCommand);
program.addCommand(listCommand);
program.addCommand(viewCommand);
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
  .description("Display help for fw or a subcommand")
  .argument("[command]", "Command to get help for")
  .action((commandName?: string) => {
    if (!commandName) {
      program.help();
      return;
    }
    const subcommand = program.commands.find((cmd) => cmd.name() === commandName);
    if (subcommand) {
      subcommand.help();
    } else {
      console.error(`Unknown command: ${commandName}`);
      console.error(`Run 'fw --help' for available commands.`);
      process.exit(1);
    }
  });

export { program };

export async function run(): Promise<void> {
  await program.parseAsync();
}
