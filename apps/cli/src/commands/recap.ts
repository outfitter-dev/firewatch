import {
  type PrState,
  buildWorklist,
  queryEntries,
  sortWorklist,
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

      // Categorize PRs
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

      // Header
      console.log(`Firewatch: ${worklist.length} open PRs, ${totalComments} comments`);

      // Categories as compact lines
      if (needsResponse.length > 0) {
        const prs = needsResponse.slice(0, 5).map((w) => `#${w.pr}`).join(", ");
        const more = needsResponse.length > 5 ? ` +${needsResponse.length - 5}` : "";
        console.log(`- Changes Requested (${needsResponse.length}): ${prs}${more}`);
      }

      if (ready.length > 0) {
        const prs = ready.slice(0, 5).map((w) => `#${w.pr}`).join(", ");
        const more = ready.length > 5 ? ` +${ready.length - 5}` : "";
        console.log(`- Ready to Merge (${ready.length}): ${prs}${more}`);
      }

      if (drafts.length > 0) {
        const prs = drafts.slice(0, 5).map((w) => `#${w.pr}`).join(", ");
        const more = drafts.length > 5 ? ` +${drafts.length - 5}` : "";
        console.log(`- Drafts (${drafts.length}): ${prs}${more}`);
      }

      // Footer
      console.log(`\nRun \`fw status --short\` for JSONL output`);
    } catch (error) {
      console.error(
        "Recap failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
