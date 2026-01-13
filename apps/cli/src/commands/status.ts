import {
  type FirewatchConfig,
  type PrState,
  loadConfig,
  parseSince,
  queryEntries,
} from "@outfitter/firewatch-core";
import { Command } from "commander";

import { outputStatusShort } from "../status";
import { outputWorklist } from "../worklist";

/**
 * Parse comma-separated state values.
 */
function parseStates(value: string): PrState[] {
  return value.split(",").map((s) => s.trim() as PrState);
}

export interface StatusCommandOptions {
  repo?: string;
  pr?: number;
  state?: string;
  open?: boolean;
  draft?: boolean;
  active?: boolean;
  label?: string;
  since?: string;
  short?: boolean;
}

function resolveStates(
  options: StatusCommandOptions,
  config: FirewatchConfig
): PrState[] | undefined {
  if (options.state) {
    return parseStates(options.state);
  }
  if (options.active) {
    return ["open", "draft"];
  }
  if (options.open && options.draft) {
    return ["open", "draft"];
  }
  if (options.open) {
    return ["open"];
  }
  if (options.draft) {
    return ["draft"];
  }
  return config.default_states ?? ["open", "draft"];
}

export function buildStatusQueryOptions(
  options: StatusCommandOptions,
  config: FirewatchConfig
) {
  const states = resolveStates(options, config);
  const since = options.since ?? config.default_since;

  return {
    filters: {
      ...(options.repo && { repo: options.repo }),
      ...(options.pr !== undefined && { pr: options.pr }),
      ...(states && { states }),
      ...(options.label && { label: options.label }),
      ...(since && { since: parseSince(since) }),
    },
    plugins: [],
  };
}

export const statusCommand = new Command("status")
  .description("Summarize PR activity")
  .option("--repo <name>", "Filter by repository (partial match)")
  .option("--pr <number>", "Filter by PR number", Number.parseInt)
  .option(
    "--state <states>",
    "Filter by PR state (comma-separated: open,closed,merged,draft)"
  )
  .option("--open", "Shorthand for --state open")
  .option("--draft", "Shorthand for --state draft")
  .option("--active", "Shorthand for --state open,draft")
  .option("--label <name>", "Filter by PR label (partial match)")
  .option("--since <duration>", "Filter by time (e.g., 24h, 7d)")
  .option("--short", "Tight per-PR summary output")
  .action(async (options: StatusCommandOptions) => {
    try {
      const config = await loadConfig();
      const entries = await queryEntries(
        buildStatusQueryOptions(options, config)
      );

      if (options.short) {
        const wrote = await outputStatusShort(entries);
        if (!wrote) {
          console.error("No entries found for status.");
        }
        return;
      }

      const wrote = await outputWorklist(entries);
      if (!wrote) {
        console.error("No entries found for status.");
      }
    } catch (error) {
      console.error(
        "Status failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
