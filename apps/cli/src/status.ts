import {
  buildWorklist,
  sortWorklist,
  type FirewatchEntry,
  type WorklistEntry,
} from "@outfitter/firewatch-core";
import type { GraphiteStack } from "@outfitter/firewatch-core/plugins";

import { ensureGraphiteMetadata } from "./stack";

export interface StatusShortEntry {
  repo: string;
  pr: number;
  pr_title: string;
  pr_state: string;
  pr_author: string;
  last_activity_at: string;
  comments: number;
  changes_requested: number;
  stack_id?: string;
  stack_position?: number;
}

export function formatStatusShort(item: WorklistEntry): StatusShortEntry {
  const short: StatusShortEntry = {
    repo: item.repo,
    pr: item.pr,
    pr_title: item.pr_title,
    pr_state: item.pr_state,
    pr_author: item.pr_author,
    last_activity_at: item.last_activity_at,
    comments: item.counts.comments,
    changes_requested: item.review_states?.changes_requested ?? 0,
  };

  if (item.graphite?.stack_id) {
    short.stack_id = item.graphite.stack_id;
    if (item.graphite.stack_position !== undefined) {
      short.stack_position = item.graphite.stack_position;
    }
  }

  return short;
}

export async function buildStatusShort(
  entries: FirewatchEntry[],
  options: { stacks?: GraphiteStack[] | null } = {}
): Promise<StatusShortEntry[]> {
  const enriched = await ensureGraphiteMetadata(entries, options);
  const worklist = sortWorklist(buildWorklist(enriched));
  return worklist.map(formatStatusShort);
}

export async function outputStatusShort(
  entries: FirewatchEntry[],
  options: { stacks?: GraphiteStack[] | null } = {}
): Promise<boolean> {
  const items = await buildStatusShort(entries, options);
  if (items.length === 0) {
    return false;
  }

  for (const item of items) {
    console.log(JSON.stringify(item));
  }

  return true;
}
