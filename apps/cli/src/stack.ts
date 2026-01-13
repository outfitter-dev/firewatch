import type {
  FirewatchEntry,
  GraphiteMetadata,
} from "@outfitter/firewatch-core";
import {
  getGraphiteStacks,
  type GraphiteStack,
} from "@outfitter/firewatch-core/plugins";

import { writeJsonLine } from "./utils/json";
interface StackGroup {
  stack_id: string;
  entries: FirewatchEntry[];
}

function buildGraphiteIndex(
  stacks: GraphiteStack[]
): Map<number, GraphiteMetadata> {
  const index = new Map<number, GraphiteMetadata>();

  for (const stack of stacks) {
    const stackSize = stack.branches.length;
    for (const [position, branch] of stack.branches.entries()) {
      if (!branch.prNumber) {
        continue;
      }
      index.set(branch.prNumber, {
        stack_id: stack.name,
        stack_position: position + 1,
        stack_size: stackSize,
        parent_pr:
          position > 0 ? stack.branches[position - 1]?.prNumber : undefined,
      });
    }
  }

  return index;
}

function applyGraphiteMetadata(
  entries: FirewatchEntry[],
  index: Map<number, GraphiteMetadata>
): FirewatchEntry[] {
  let changed = false;
  const updated = entries.map((entry) => {
    if (entry.graphite?.stack_id) {
      return entry;
    }
    const metadata = index.get(entry.pr);
    if (!metadata) {
      return entry;
    }
    changed = true;
    return { ...entry, graphite: metadata };
  });

  return changed ? updated : entries;
}

export async function ensureGraphiteMetadata(
  entries: FirewatchEntry[],
  options: { stacks?: GraphiteStack[] | null } = {}
): Promise<FirewatchEntry[]> {
  const needsGraphiteMetadata = entries.some(
    (entry) => !entry.graphite?.stack_id
  );
  if (!needsGraphiteMetadata) {
    return entries;
  }

  const stacks = options.stacks ?? (await getGraphiteStacks());
  if (!stacks) {
    return entries;
  }

  const index = buildGraphiteIndex(stacks);
  return applyGraphiteMetadata(entries, index);
}

function groupEntriesByStack(entries: FirewatchEntry[]): StackGroup[] {
  const groups: StackGroup[] = [];
  const index = new Map<string, StackGroup>();

  for (const entry of entries) {
    const stackId = entry.graphite?.stack_id;
    if (!stackId) {
      continue;
    }

    let group = index.get(stackId);
    if (!group) {
      group = { stack_id: stackId, entries: [] };
      index.set(stackId, group);
      groups.push(group);
    }

    group.entries.push(entry);
  }

  return groups;
}

export async function outputStackedEntries(
  entries: FirewatchEntry[],
  options: { stacks?: GraphiteStack[] | null } = {}
): Promise<boolean> {
  const stackEntries = await ensureGraphiteMetadata(entries, options);

  const groups = groupEntriesByStack(stackEntries);
  if (groups.length === 0) {
    return false;
  }

  for (const group of groups) {
    await writeJsonLine(group);
  }

  return true;
}
