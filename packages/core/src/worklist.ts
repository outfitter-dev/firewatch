import type { FirewatchEntry } from "./schema/entry";
import type { WorklistCounts, WorklistEntry, WorklistReviewStates } from "./schema/worklist";

function initCounts(): WorklistCounts {
  return {
    comments: 0,
    reviews: 0,
    commits: 0,
    ci: 0,
    events: 0,
  };
}

function initReviewStates(): WorklistReviewStates {
  return {
    approved: 0,
    changes_requested: 0,
    commented: 0,
    dismissed: 0,
  };
}

function entryTimestamp(entry: FirewatchEntry): number {
  return new Date(entry.updated_at ?? entry.created_at).getTime();
}

interface WorklistAccumulator {
  item: WorklistEntry;
  lastActivityMs: number;
}

function createAccumulator(entry: FirewatchEntry): WorklistAccumulator {
  const item: WorklistEntry = {
    repo: entry.repo,
    pr: entry.pr,
    pr_title: entry.pr_title,
    pr_state: entry.pr_state,
    pr_author: entry.pr_author,
    pr_branch: entry.pr_branch,
    ...(entry.pr_labels && { pr_labels: entry.pr_labels }),
    last_activity_at: entry.updated_at ?? entry.created_at,
    latest_activity_type: entry.type,
    latest_activity_author: entry.author,
    counts: initCounts(),
    review_states: initReviewStates(),
    ...(entry.graphite && { graphite: entry.graphite }),
  };

  return { item, lastActivityMs: entryTimestamp(entry) };
}

function applyCounts(item: WorklistEntry, entry: FirewatchEntry): void {
  switch (entry.type) {
    case "comment":
      item.counts.comments += 1;
      break;
    case "review":
      item.counts.reviews += 1;
      break;
    case "commit":
      item.counts.commits += 1;
      break;
    case "ci":
      item.counts.ci += 1;
      break;
    case "event":
      item.counts.events += 1;
      break;
  }
}

function applyReviewState(item: WorklistEntry, entry: FirewatchEntry): void {
  if (entry.type !== "review" || !entry.state || !item.review_states) {
    return;
  }

  const state = entry.state.toLowerCase();
  if (state === "approved") {
    item.review_states.approved += 1;
  } else if (state === "changes_requested") {
    item.review_states.changes_requested += 1;
  } else if (state === "commented") {
    item.review_states.commented += 1;
  } else if (state === "dismissed") {
    item.review_states.dismissed += 1;
  }
}

function applyMetadata(item: WorklistEntry, entry: FirewatchEntry): void {
  if (!item.graphite && entry.graphite) {
    item.graphite = entry.graphite;
  }

  if (!item.pr_labels && entry.pr_labels) {
    item.pr_labels = entry.pr_labels;
  }

  if (item.pr_state !== entry.pr_state) {
    item.pr_state = entry.pr_state;
  }
}

function updateLatestActivity(
  accumulator: WorklistAccumulator,
  entry: FirewatchEntry
): void {
  const activityMs = entryTimestamp(entry);
  if (activityMs <= accumulator.lastActivityMs) {
    return;
  }

  accumulator.lastActivityMs = activityMs;
  accumulator.item.last_activity_at = entry.updated_at ?? entry.created_at;
  accumulator.item.latest_activity_type = entry.type;
  accumulator.item.latest_activity_author = entry.author;
}

export function buildWorklist(entries: FirewatchEntry[]): WorklistEntry[] {
  const byPr = new Map<string, WorklistAccumulator>();

  for (const entry of entries) {
    const key = `${entry.repo}#${entry.pr}`;
    let accumulator = byPr.get(key);
    if (!accumulator) {
      accumulator = createAccumulator(entry);
      byPr.set(key, accumulator);
    }

    applyCounts(accumulator.item, entry);
    applyReviewState(accumulator.item, entry);
    applyMetadata(accumulator.item, entry);
    updateLatestActivity(accumulator, entry);
  }

  return [...byPr.values()].map((value) => value.item);
}

export function sortWorklist(items: WorklistEntry[]): WorklistEntry[] {
  const withStack = items.filter(
    (item): item is WorklistEntry & {
      graphite: NonNullable<WorklistEntry["graphite"]> & { stack_id: string };
    } => Boolean(item.graphite?.stack_id)
  );
  const withoutStack = items.filter((item) => !item.graphite?.stack_id);

  if (withStack.length === 0) {
    return withoutStack.toSorted(
      (a, b) =>
        new Date(b.last_activity_at).getTime() -
        new Date(a.last_activity_at).getTime()
    );
  }

  const stackGroups = new Map<string, WorklistEntry[]>();
  for (const item of withStack) {
    const stackId = item.graphite.stack_id;
    const group = stackGroups.get(stackId) ?? [];
    group.push(item);
    stackGroups.set(stackId, group);
  }

  const sortedStacks = [...stackGroups.entries()]
    .map(([stackId, group]) => {
      const sortedGroup = group.toSorted((a, b) => {
        const aPos = a.graphite?.stack_position ?? Number.MAX_SAFE_INTEGER;
        const bPos = b.graphite?.stack_position ?? Number.MAX_SAFE_INTEGER;
        if (aPos !== bPos) {
          return aPos - bPos;
        }
        return (
          new Date(b.last_activity_at).getTime() -
          new Date(a.last_activity_at).getTime()
        );
      });

      let lastActivity = 0;
      for (const item of sortedGroup) {
        const ts = new Date(item.last_activity_at).getTime();
        if (ts > lastActivity) {
          lastActivity = ts;
        }
      }

      return { stackId, group: sortedGroup, lastActivity };
    })
    .toSorted((a, b) => b.lastActivity - a.lastActivity);

  const sortedWithoutStack = withoutStack.toSorted(
    (a, b) =>
      new Date(b.last_activity_at).getTime() -
      new Date(a.last_activity_at).getTime()
  );

  return [
    ...sortedStacks.flatMap((stack) => stack.group),
    ...sortedWithoutStack,
  ];
}
