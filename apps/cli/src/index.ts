import { createCLI } from "@outfitter/cli/command";
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
import { freezeCommand } from "./commands/freeze";
import { listCommand } from "./commands/list";
import { mcpCommand } from "./commands/mcp";
import { queryCommand } from "./commands/query";
import { rejectCommand } from "./commands/reject";
import { replyCommand } from "./commands/reply";
import { schemaCommand } from "./commands/schema";
import { statusCommand } from "./commands/status";
import { syncCommand } from "./commands/sync";
import { unfreezeCommand } from "./commands/unfreeze";
import { viewCommand } from "./commands/view";
import { executeCliQuery } from "./query";
import {
  applyGlobalOptions,
  type QueryCommandOptions,
  validateLimit,
  validateRepoSlug,
} from "./query-helpers";
import { emitAliasHint } from "./utils/alias-hint";

const cli = createCLI({
  name: "fw",
  version,
  description:
    "GitHub PR activity logger with pure JSONL output for jq-based workflows",
});

const { program } = cli;
program.enablePositionalOptions();
program.showSuggestionAfterError(true);

// Root command acts as query shorthand: `fw --since 24h` === `fw query --since 24h`
program
  .option("--pr [numbers]", "Filter to PR domain, optionally specific PRs")
  .option("--repo <name>", "Filter to specific repository", validateRepoSlug)
  .option("--all", "Include all cached repos")
  .option("--mine", "Items on PRs assigned to me")
  .option("--reviews", "PRs I need to review")
  .option("--open", "Filter to open PRs (includes drafts)")
  .option("--ready", "Filter to ready PRs (open, non-draft)")
  .option("--closed", "Include merged and closed PRs")
  .option("--draft", "Filter to draft PRs")
  .option("--orphaned", "Unresolved review comments on merged/closed PRs")
  .option("--stale", "Include unresolved review comments on merged/closed PRs")
  .option("--include-frozen", "Include activity after freeze timestamps")
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
  .option(
    "--before <date>",
    "Entries created before ISO date (e.g., 2024-01-15)"
  )
  .option("--no-sync", "Skip auto-sync; use cache only")
  .option("--sync-full", "Force a full sync before query")
  .option("-n, --limit <count>", "Limit number of results", validateLimit)
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
  .argument("[args...]")
  .action(async (args: string[], options: QueryCommandOptions) => {
    applyGlobalOptions(options);

    // Check if the first arg looks like a typo'd command rather than a query parameter
    const maybeCmd = args[0];
    if (maybeCmd) {
      // Single lowercase word with only letters, digits, hyphens = likely a command typo
      if (/^[a-z][a-z0-9-]*$/.test(maybeCmd)) {
        console.error(`Unknown command: ${maybeCmd}`);
        console.error(`Run 'fw --help' for available commands.`);
        process.exit(1);
      }
      // Otherwise it's an unexpected argument (repo slug, etc) - reject it
      console.error(`Unexpected argument: ${maybeCmd}`);
      console.error(`Run 'fw --help' for usage information.`);
      process.exit(1);
    }

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

// Register subcommands
cli
  .register(queryCommand)
  .register(syncCommand)
  .register(editCommand)
  .register(ackCommand)
  .register(closeCommand)
  .register(commentCommand)
  .register(approveCommand)
  .register(rejectCommand)
  .register(freezeCommand)
  .register(unfreezeCommand);

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

cli
  .register(replyCommand)
  .register(listCommand)
  .register(viewCommand)
  .register(claudePluginCommand)
  .register(statusCommand)
  .register(configCommand)
  .register(doctorCommand)
  .register(schemaCommand)
  .register(examplesCommand)
  .register(mcpCommand);

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
    const subcommand = program.commands.find(
      (cmd) => cmd.name() === commandName
    );
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
  await cli.parse();
}
