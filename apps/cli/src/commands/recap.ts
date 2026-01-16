import {
  type PrState,
  buildAuthorIndex,
  buildWorklist,
  getAuthorStatsSorted,
  queryEntries,
  sortWorklist,
  type FirewatchEntry,
  type WorklistEntry,
} from "@outfitter/firewatch-core";
import {
  getGraphiteStacks,
  graphitePlugin,
} from "@outfitter/firewatch-core/plugins";
import { Command } from "commander";

interface RecapCommandOptions {
  repo?: string;
  since?: string;
}

interface ReviewsByState {
  approved: number;
  changes_requested: number;
  commented: number;
  dismissed: number;
}

interface TopContributor {
  author: string;
  count: number;
  isBot: boolean;
}

interface RecapSummary {
  total: number;
  totalComments: number;
  totalReviews: number;
  totalCommits: number;
  needsResponse: WorklistEntry[];
  ready: WorklistEntry[];
  drafts: WorklistEntry[];
  reviewsByState: ReviewsByState;
  topContributors: TopContributor[];
}

function buildRecapSummary(
  entries: FirewatchEntry[],
  worklist: WorklistEntry[]
): RecapSummary {
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

  // Count reviews by state
  const reviewsByState: ReviewsByState = {
    approved: 0,
    changes_requested: 0,
    commented: 0,
    dismissed: 0,
  };
  let totalReviews = 0;
  let totalCommits = 0;

  for (const entry of entries) {
    if (entry.type === "review" && entry.state) {
      totalReviews++;
      const state = entry.state.toLowerCase();
      if (state === "approved") {
        reviewsByState.approved++;
      } else if (state === "changes_requested") {
        reviewsByState.changes_requested++;
      } else if (state === "commented") {
        reviewsByState.commented++;
      } else if (state === "dismissed") {
        reviewsByState.dismissed++;
      }
    } else if (entry.type === "commit") {
      totalCommits++;
    }
  }

  // Top contributors (excluding bots)
  const authorIndex = buildAuthorIndex(entries);
  const sortedAuthors = getAuthorStatsSorted(authorIndex);
  const topContributors = sortedAuthors
    .filter((a) => !a.isBot)
    .slice(0, 5)
    .map((a) => ({
      author: a.author,
      count: a.count,
      isBot: a.isBot,
    }));

  return {
    total: worklist.length,
    totalComments,
    totalReviews,
    totalCommits,
    needsResponse,
    ready,
    drafts,
    reviewsByState,
    topContributors,
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
    `Firewatch: ${summary.total} open PRs, ${summary.totalComments} comments, ${summary.totalReviews} reviews, ${summary.totalCommits} commits`
  );

  // PR status groups
  const prLines = [
    formatRecapGroup("Changes Requested", summary.needsResponse),
    formatRecapGroup("Ready to Merge", summary.ready),
    formatRecapGroup("Drafts", summary.drafts),
  ].filter(Boolean);

  if (prLines.length > 0) {
    console.log("\nPR Status:");
    for (const line of prLines) {
      console.log(line);
    }
  }

  // Reviews by state
  const { reviewsByState } = summary;
  const hasReviews =
    reviewsByState.approved > 0 ||
    reviewsByState.changes_requested > 0 ||
    reviewsByState.commented > 0;

  if (hasReviews) {
    console.log("\nReviews by State:");
    if (reviewsByState.approved > 0) {
      console.log(`  approved: ${reviewsByState.approved}`);
    }
    if (reviewsByState.changes_requested > 0) {
      console.log(`  changes_requested: ${reviewsByState.changes_requested}`);
    }
    if (reviewsByState.commented > 0) {
      console.log(`  commented: ${reviewsByState.commented}`);
    }
  }

  // Top contributors
  if (summary.topContributors.length > 0) {
    console.log("\nTop Contributors:");
    for (const contrib of summary.topContributors) {
      console.log(`  ${contrib.author}: ${contrib.count} items`);
    }
  }

  console.log("\nRun `fw status --short` for JSONL output");
}

export const recapCommand = new Command("recap")
  .description("Human-readable summary of PR activity")
  .option("--repo <name>", "Filter by repository")
  .option("--since <duration>", "Filter by time (e.g., 24h, 7d)")
  .action(async (options: RecapCommandOptions) => {
    try {
      const states: PrState[] = ["open", "draft"];

      const entries = await queryEntries({
        filters: {
          ...(options.repo && { repo: options.repo }),
          states,
        },
      });

      if (entries.length === 0) {
        console.log("No open PRs found. Run `fw sync` to fetch data.");
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
      const summary = buildRecapSummary(enrichedEntries, worklist);
      printRecapSummary(summary);
    } catch (error) {
      console.error(
        "Recap failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
