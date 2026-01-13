import {
  buildWorklist,
  detectRepo,
  loadConfig,
  parseSince,
  queryEntries,
  sortWorklist,
  type WorklistEntry,
} from "@outfitter/firewatch-core";
import {
  getGraphiteStacks,
  graphitePlugin,
} from "@outfitter/firewatch-core/plugins";
import { Command } from "commander";

import { resolveStates } from "../utils/states";
import { writeJsonLine } from "../utils/json";

interface RecapCommandOptions {
  repo?: string;
  all?: boolean;
  state?: string;
  open?: boolean;
  draft?: boolean;
  active?: boolean;
  since?: string;
  json?: boolean;
}

interface RecapSummary {
  total: number;
  totalComments: number;
  needsResponse: WorklistEntry[];
  ready: WorklistEntry[];
  drafts: WorklistEntry[];
}

function buildRecapSummary(worklist: WorklistEntry[]): RecapSummary {
  const needsResponse = worklist.filter(
    (w) => (w.review_states?.changes_requested ?? 0) > 0
  );
  const ready = worklist.filter(
    (w) =>
      w.pr_state === "open" &&
      (w.review_states?.approved ?? 0) > 0 &&
      (w.review_states?.changes_requested ?? 0) === 0
  );
  const drafts = worklist.filter((w) => w.pr_state === "draft");
  const totalComments = worklist.reduce(
    (sum, w) => sum + w.counts.comments,
    0
  );

  return {
    total: worklist.length,
    totalComments,
    needsResponse,
    ready,
    drafts,
  };
}

function formatRecapGroup(
  label: string,
  items: WorklistEntry[]
): string | null {
  if (items.length === 0) {
    return null;
  }
  const prs = items.slice(0, 5).map((w) => `#${w.pr}`).join(", ");
  const more = items.length > 5 ? ` +${items.length - 5}` : "";
  return `- ${label} (${items.length}): ${prs}${more}`;
}

function printRecapSummary(summary: RecapSummary): void {
  console.log(
    `Firewatch: ${summary.total} open PRs, ${summary.totalComments} comments`
  );

  const lines = [
    formatRecapGroup("Changes Requested", summary.needsResponse),
    formatRecapGroup("Ready to Merge", summary.ready),
    formatRecapGroup("Drafts", summary.drafts),
  ];

  for (const line of lines) {
    if (line) {
      console.log(line);
    }
  }

  console.log("\nRun `fw status --short` for JSONL output");
}

export const recapCommand = new Command("recap")
  .description("Human-readable summary of PR activity")
  .option("--repo <name>", "Filter by repository (partial match)")
  .option("--all", "Query across all cached repos")
  .option(
    "--state <states>",
    "Filter by PR state (comma-separated: open,closed,merged,draft)"
  )
  .option("--open", "Shorthand for --state open")
  .option("--draft", "Shorthand for --state draft")
  .option("--active", "Shorthand for --state open,draft")
  .option("--since <duration>", "Filter by time (e.g., 24h, 7d)")
  .option("--json", "Output JSONL instead of text")
  .action(async (options: RecapCommandOptions) => {
    try {
      let repoFilter = options.repo;
      if (!repoFilter && !options.all) {
        const detected = await detectRepo();
        if (detected.repo) {
          console.error(`Querying ${detected.repo} (from ${detected.source})`);
          repoFilter = detected.repo;
        }
      }

      const config = await loadConfig();
      const states = resolveStates(options, config);
      const since = options.since ?? config.default_since;

      const entries = await queryEntries({
        filters: {
          ...(repoFilter && { repo: repoFilter }),
          states,
          ...(since && { since: parseSince(since) }),
        },
      });

      if (entries.length === 0) {
        const message = "No open PRs found. Run `fw sync` to fetch data.";
        if (options.json) {
          console.error(message);
          return;
        }
        console.log(message);
        return;
      }

      // Enrich with Graphite if available
      let enrichedEntries = entries;
      const stacks = await getGraphiteStacks();
      if (stacks && graphitePlugin.enrich) {
        enrichedEntries = await Promise.all(
          entries.map((e) => graphitePlugin.enrich!(e))
        );
      }

      const worklist = sortWorklist(buildWorklist(enrichedEntries));

      if (options.json) {
        for (const item of worklist) {
          await writeJsonLine(item);
        }
        return;
      }

      const summary = buildRecapSummary(worklist);
      printRecapSummary(summary);
    } catch (error) {
      console.error(
        "Recap failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
