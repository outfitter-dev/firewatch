import type {
  FirewatchConfig,
  FirewatchEntry,
} from "@outfitter/firewatch-core";

import { outputStackedEntries } from "../stack";
import { outputWorklist } from "../worklist";
import { writeJsonLine } from "./json";

export interface OutputOptions {
  stack?: boolean;
  worklist?: boolean;
  since?: string;
  state?: string;
  open?: boolean;
  draft?: boolean;
  active?: boolean;
}

export async function outputEntries(
  entries: FirewatchEntry[],
  options: OutputOptions,
  config: FirewatchConfig
): Promise<void> {
  if (options.worklist) {
    const wrote = await outputWorklist(entries);
    if (!wrote) {
      const hints: string[] = [];
      if (!options.since && config.default_since) {
        hints.push(`default_since=${config.default_since}`);
      }
      if (!options.state && !options.open && !options.draft && !options.active) {
        const states = config.default_states;
        if (states && states.length > 0) {
          hints.push(`default_states=${states.join(",")}`);
        }
      }
      const suffix = hints.length > 0 ? ` (filters: ${hints.join(", ")})` : "";
      console.error(`No entries found for worklist.${suffix}`);
      console.error("Try widening filters with --since or --state.");
    }
    return;
  }

  const stackMode = options.stack || config.default_stack;
  if (stackMode) {
    const wrote = await outputStackedEntries(entries);
    if (!wrote) {
      console.error(
        "No Graphite stack data found. Run `fw sync --with-graphite` from the repo or enable graphite in config."
      );
    }
    return;
  }

  for (const entry of entries) {
    await writeJsonLine(entry);
  }
}
