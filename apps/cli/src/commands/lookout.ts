import {
  GitHubClient,
  buildLookoutContext,
  buildLookoutSummary,
  detectAuth,
  detectRepo,
  ensureDirectories,
  loadConfig,
  parseSince,
  queryEntries,
  setLookoutFor,
  syncRepo,
  type LookoutSummary,
} from "@outfitter/firewatch-core";
import {
  getGraphiteStacks,
  graphitePlugin,
} from "@outfitter/firewatch-core/plugins";
import { Command } from "commander";

import { writeJsonLine } from "../utils/json";

interface LookoutCommandOptions {
  repo?: string;
  all?: boolean;
  since?: string;
  reset?: boolean;
  json?: boolean;
}

function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = Date.now();
  const diffMs = now - date.getTime();

  const minutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

interface AttentionItem {
  pr: number;
  pr_title: string;
}

interface FeedbackItem {
  pr: number;
  author: string;
  body?: string | undefined;
  is_bot: boolean;
}

function printAttentionSection<T extends AttentionItem>(
  title: string,
  items: T[]
): void {
  if (items.length === 0) {
    return;
  }

  console.log(`\n${title} (${items.length})`);
  for (const item of items.slice(0, 5)) {
    console.log(`  #${item.pr} ${item.pr_title}`);
  }
  if (items.length > 5) {
    console.log(`  +${items.length - 5} more`);
  }
}

function printFeedbackSection(items: FeedbackItem[]): void {
  if (items.length === 0) {
    return;
  }

  console.log(`\nUnaddressed Feedback (${items.length})`);
  for (const fb of items.slice(0, 5)) {
    const botTag = fb.is_bot ? " [bot]" : "";
    const bodyPreview = fb.body?.slice(0, 50).replaceAll("\n", " ") ?? "";
    console.log(`  #${fb.pr}: ${fb.author}${botTag} - ${bodyPreview}...`);
  }
  if (items.length > 5) {
    console.log(`  +${items.length - 5} more`);
  }
}

function printLookoutSummary(summary: LookoutSummary): void {
  const { period, counts, attention, unaddressed_feedback } = summary;

  // Header
  console.log(`\n=== Firewatch Lookout: ${summary.repo} ===`);
  if (summary.first_run) {
    console.log(`(First run - showing recent activity)`);
  } else {
    console.log(`Since: ${formatRelativeTime(period.since)}`);
  }
  if (summary.synced_at) {
    console.log(`(Auto-synced)`);
  }

  // Activity summary
  console.log(
    `\nActivity: ${counts.prs_active} PRs, ${counts.comments} comments, ${counts.reviews} reviews, ${counts.commits} commits`
  );

  // Nothing to report
  const hasAttentionItems =
    attention.changes_requested.length > 0 ||
    attention.unreviewed.length > 0 ||
    attention.stale.length > 0 ||
    unaddressed_feedback.length > 0;

  if (!hasAttentionItems) {
    console.log("\nAll clear - no items need attention.");
    return;
  }

  // Attention sections
  printAttentionSection("Changes Requested", attention.changes_requested);
  printAttentionSection("Needs Review", attention.unreviewed);
  printAttentionSection("Stale", attention.stale);
  printFeedbackSection(unaddressed_feedback);

  console.log(`\nRun \`fw status --short\` for full worklist`);
}

export const lookoutCommand = new Command("lookout")
  .description("PR activity reconnaissance - what needs attention")
  .option("--repo <name>", "Filter by repository")
  .option("--all", "Query across all cached repos")
  .option("--since <duration>", "Override smart time default (e.g., 24h, 7d)")
  .option("--reset", "Clear last lookout timestamp, show from fallback")
  .option("--json", "Output JSONL for agents")
  .action(async (options: LookoutCommandOptions) => {
    try {
      await ensureDirectories();

      // Resolve repo
      let repoFilter = options.repo;
      if (!repoFilter && !options.all) {
        const detected = await detectRepo();
        if (detected.repo) {
          console.error(`Querying ${detected.repo} (from ${detected.source})`);
          repoFilter = detected.repo;
        }
      }

      if (!repoFilter && !options.all) {
        console.error(
          "No repository detected. Use: fw lookout --repo org/repo"
        );
        process.exit(1);
      }

      const config = await loadConfig();

      // Build lookout context
      const context = await buildLookoutContext({
        repo: repoFilter!,
        since: options.since ? parseSince(options.since) : undefined,
        reset: options.reset,
        config,
      });

      // Auto-sync if stale
      let syncedAt: Date | undefined;
      if (context.syncNeeded) {
        if (!options.json) {
          console.error(`Syncing ${context.repo} (cache is stale)...`);
        }

        const auth = await detectAuth(config.github_token);
        if (!auth.token) {
          console.error(auth.error ?? "Authentication failed");
          process.exit(1);
        }

        const client = new GitHubClient(auth.token);
        const detected = await detectRepo();
        const graphiteEnabled =
          config.graphite_enabled ||
          (detected.repo === context.repo &&
            (await getGraphiteStacks()) !== null);

        await syncRepo(client, context.repo, {
          plugins: graphiteEnabled ? [graphitePlugin] : [],
        });

        syncedAt = new Date();

        if (!options.json) {
          console.error(`Synced ${context.repo}`);
        }
      }

      // Query entries
      const entries = await queryEntries({
        filters: {
          repo: context.repo,
          since: context.since,
          states: ["open", "draft"],
        },
      });

      // Build summary
      const summary = buildLookoutSummary(entries, context, syncedAt);

      // Update lookout timestamp
      await setLookoutFor(context.repo, context.until);

      // Output
      if (options.json) {
        await writeJsonLine(summary);
      } else {
        printLookoutSummary(summary);
      }
    } catch (error) {
      console.error(
        "Lookout failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
