import { $ } from "bun";

import type { FirewatchEntry, FirewatchPlugin } from "../../core";

interface GraphiteStackBranch {
  name: string;
  prNumber?: number;
}

interface GraphiteStack {
  name: string;
  branches: GraphiteStackBranch[];
}

/**
 * Graphite plugin for stack-aware PR activity tracking.
 *
 * Enriches entries with Graphite stack context, enabling queries like:
 * fw query --type review | jq 'select(.graphite.stack_id == "feat-auth")'
 */
export const graphitePlugin: FirewatchPlugin = {
  name: "graphite",
  version: "1.0.0",

  async enrich(entry: FirewatchEntry): Promise<FirewatchEntry> {
    try {
      // Get stack info for the PR's branch
      const result = await $`gt log --json`.nothrow().quiet();

      if (result.exitCode !== 0) {
        return entry;
      }

      const stacks = JSON.parse(result.text()) as GraphiteStack[];

      const stack = stacks.find((s) =>
        s.branches.some((b) => b.prNumber === entry.pr)
      );

      if (stack) {
        const position = stack.branches.findIndex(
          (b) => b.prNumber === entry.pr
        );

        if (position !== -1) {
          entry.graphite = {
            stack_id: stack.name,
            stack_position: position + 1,
            stack_size: stack.branches.length,
            parent_pr:
              position > 0 ? stack.branches[position - 1]?.prNumber : undefined,
          };
        }
      }
    } catch {
      // Graphite not available or not in a repo, skip enrichment
    }

    return entry;
  },

  queryFilters() {
    return {
      stack: (entry, value) => entry.graphite?.stack_id === value,
      "stack-position": (entry, value) =>
        entry.graphite?.stack_position === Number.parseInt(value, 10),
    };
  },
};
