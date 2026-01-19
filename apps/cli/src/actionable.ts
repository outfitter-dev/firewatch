import {
  buildWorklist,
  sortWorklist,
  type FirewatchEntry,
  type WorklistEntry,
} from "@outfitter/firewatch-core";

import {
  type TreeNode,
  renderCategory,
  renderHeader,
  truncate,
} from "./utils/tree";

export type ActionableCategory =
  | "unaddressed"
  | "changes_requested"
  | "awaiting_review"
  | "stale";

export interface AttentionItem {
  repo: string;
  pr: number;
  pr_title: string;
  pr_state: string;
  pr_author: string;
  pr_branch: string;
  last_activity_at: string;
  reason: "changes_requested" | "no_reviews" | "stale";
  graphite?: WorklistEntry["graphite"];
}

export interface UnaddressedFeedback {
  repo: string;
  pr: number;
  pr_title: string;
  pr_branch: string;
  comment_id: string;
  author: string;
  body?: string;
  created_at: string;
  file?: string;
  line?: number;
  is_bot: boolean;
}

export interface ActionableItem {
  category: ActionableCategory;
  repo: string;
  pr: number;
  pr_title: string;
  pr_author: string;
  pr_branch: string;
  pr_state: string;
  description: string;
  count: number;
  url?: string;
  graphite?: WorklistEntry["graphite"];
}

export interface ActionableSummary {
  repo: string;
  username?: string;
  perspective?: "mine" | "reviews";
  items: ActionableItem[];
  counts: {
    unaddressed: number;
    changes_requested: number;
    awaiting_review: number;
    stale: number;
    total: number;
  };
}

const STALE_DAYS_THRESHOLD = 3;
const BOT_SUFFIXES = ["[bot]", "-bot"];

function isBot(author: string): boolean {
  return BOT_SUFFIXES.some((suffix) => author.endsWith(suffix));
}

function isStaleItem(lastActivityAt: string): boolean {
  const lastActivity = new Date(lastActivityAt);
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - STALE_DAYS_THRESHOLD);
  return lastActivity < threshold;
}

function formatAuthorSummary(feedbacks: UnaddressedFeedback[]): string {
  const authorCounts = new Map<string, number>();
  for (const fb of feedbacks) {
    authorCounts.set(fb.author, (authorCounts.get(fb.author) ?? 0) + 1);
  }
  const sorted = [...authorCounts.entries()].toSorted((a, b) => b[1] - a[1]);
  const display = sorted
    .slice(0, 3)
    .map(([author, count]) => `${author} (${count})`)
    .join(", ");
  const extra = sorted.length > 3 ? `, +${sorted.length - 3} more` : "";
  return display + extra;
}

function toAttentionItem(
  item: WorklistEntry,
  reason: AttentionItem["reason"]
): AttentionItem {
  return {
    repo: item.repo,
    pr: item.pr,
    pr_title: item.pr_title,
    pr_state: item.pr_state,
    pr_author: item.pr_author,
    pr_branch: item.pr_branch,
    last_activity_at: item.last_activity_at,
    reason,
    ...(item.graphite && { graphite: item.graphite }),
  };
}

export function identifyAttentionItems(worklist: WorklistEntry[]): {
  changes_requested: AttentionItem[];
  unreviewed: AttentionItem[];
  stale: AttentionItem[];
} {
  const changes_requested = worklist
    .filter((w) => (w.review_states?.changes_requested ?? 0) > 0)
    .map((w) => toAttentionItem(w, "changes_requested"));

  const unreviewed = worklist
    .filter(
      (w) =>
        (w.pr_state === "open" || w.pr_state === "draft") &&
        (w.review_states?.approved ?? 0) === 0 &&
        (w.review_states?.changes_requested ?? 0) === 0 &&
        (w.review_states?.commented ?? 0) === 0
    )
    .map((w) => toAttentionItem(w, "no_reviews"));

  const stale = worklist
    .filter(
      (w) =>
        w.pr_state === "open" &&
        isStaleItem(w.last_activity_at) &&
        (w.review_states?.changes_requested ?? 0) === 0
    )
    .map((w) => toAttentionItem(w, "stale"));

  return { changes_requested, unreviewed, stale };
}

export function identifyUnaddressedFeedback(
  entries: FirewatchEntry[]
): UnaddressedFeedback[] {
  // Only include review_comment subtype (inline code comments), not issue_comment (top-level PR comments)
  const commentEntries = entries.filter(
    (e) => e.type === "comment" && e.subtype === "review_comment"
  );

  // Use repo:pr composite key for cross-repo safety
  const commitsByRepoPr = new Map<string, FirewatchEntry[]>();
  for (const entry of entries) {
    if (entry.type === "commit") {
      const key = `${entry.repo}:${entry.pr}`;
      const existing = commitsByRepoPr.get(key) ?? [];
      existing.push(entry);
      commitsByRepoPr.set(key, existing);
    }
  }

  const hasLaterCommit = (
    repo: string,
    pr: number,
    createdAt: string
  ): boolean => {
    const key = `${repo}:${pr}`;
    const prCommits = commitsByRepoPr.get(key) ?? [];
    const time = new Date(createdAt).getTime();
    return prCommits.some((c) => new Date(c.created_at).getTime() > time);
  };

  return commentEntries
    .filter((comment) => {
      if (!comment.file) {
        return !hasLaterCommit(comment.repo, comment.pr, comment.created_at);
      }

      if (comment.file_activity_after) {
        return !comment.file_activity_after.modified;
      }

      return !hasLaterCommit(comment.repo, comment.pr, comment.created_at);
    })
    .map((e) => ({
      repo: e.repo,
      pr: e.pr,
      pr_title: e.pr_title,
      pr_branch: e.pr_branch,
      comment_id: e.id,
      author: e.author,
      ...(e.body && { body: e.body.slice(0, 200) }),
      created_at: e.created_at,
      ...(e.file && { file: e.file }),
      ...(e.line !== undefined && { line: e.line }),
      is_bot: isBot(e.author),
    }));
}

function buildActionableItems(
  entries: FirewatchEntry[],
  attention: ReturnType<typeof identifyAttentionItems>,
  unaddressedFeedback: UnaddressedFeedback[]
): ActionableItem[] {
  const items: ActionableItem[] = [];

  // Build O(1) lookup map using repo:pr composite key for cross-repo safety
  const entryByRepoPr = new Map<string, FirewatchEntry>();
  for (const entry of entries) {
    const key = `${entry.repo}:${entry.pr}`;
    if (!entryByRepoPr.has(key)) {
      entryByRepoPr.set(key, entry);
    }
  }

  const feedbackByRepoPr = new Map<string, UnaddressedFeedback[]>();
  for (const fb of unaddressedFeedback) {
    if (fb.is_bot) {
      continue;
    }
    const key = `${fb.repo}:${fb.pr}`;
    const entry = entryByRepoPr.get(key);
    if (entry && fb.author === entry.pr_author) {
      continue;
    }

    const list = feedbackByRepoPr.get(key) ?? [];
    list.push(fb);
    feedbackByRepoPr.set(key, list);
  }

  for (const [key, feedbacks] of feedbackByRepoPr) {
    const entry = entryByRepoPr.get(key);
    if (!entry) {
      continue;
    }

    items.push({
      category: "unaddressed",
      repo: entry.repo,
      pr: entry.pr,
      pr_title: entry.pr_title,
      pr_author: entry.pr_author,
      pr_branch: entry.pr_branch,
      pr_state: entry.pr_state,
      description: formatAuthorSummary(feedbacks),
      count: feedbacks.length,
      ...(entry.url && { url: entry.url }),
      ...(entry.graphite && { graphite: entry.graphite }),
    });
  }

  for (const item of attention.changes_requested) {
    if (
      items.some(
        (i) =>
          i.repo === item.repo &&
          i.pr === item.pr &&
          i.category === "unaddressed"
      )
    ) {
      continue;
    }

    items.push({
      category: "changes_requested",
      repo: item.repo,
      pr: item.pr,
      pr_title: item.pr_title,
      pr_author: item.pr_author,
      pr_branch: item.pr_branch,
      pr_state: item.pr_state,
      description: "Changes requested",
      count: 1,
      ...(item.graphite && { graphite: item.graphite }),
    });
  }

  for (const item of attention.unreviewed) {
    items.push({
      category: "awaiting_review",
      repo: item.repo,
      pr: item.pr,
      pr_title: item.pr_title,
      pr_author: item.pr_author,
      pr_branch: item.pr_branch,
      pr_state: item.pr_state,
      description: "Awaiting first review",
      count: 1,
      ...(item.graphite && { graphite: item.graphite }),
    });
  }

  for (const item of attention.stale) {
    items.push({
      category: "stale",
      repo: item.repo,
      pr: item.pr,
      pr_title: item.pr_title,
      pr_author: item.pr_author,
      pr_branch: item.pr_branch,
      pr_state: item.pr_state,
      description: "No recent activity",
      count: 1,
      ...(item.graphite && { graphite: item.graphite }),
    });
  }

  return items;
}

function filterByPerspective(
  items: ActionableItem[],
  username: string | undefined,
  perspective: "mine" | "reviews" | undefined
): ActionableItem[] {
  if (!username || !perspective) {
    return items;
  }

  if (perspective === "mine") {
    return items.filter((item) => item.pr_author === username);
  }

  return items.filter((item) => item.pr_author !== username);
}

export function buildActionableSummary(
  repo: string,
  entries: FirewatchEntry[],
  perspective?: "mine" | "reviews",
  username?: string
): ActionableSummary {
  const worklist = sortWorklist(buildWorklist(entries));
  const attention = identifyAttentionItems(worklist);
  const unaddressedFeedback = identifyUnaddressedFeedback(entries);
  let items = buildActionableItems(entries, attention, unaddressedFeedback);
  items = filterByPerspective(items, username, perspective);

  const counts = {
    unaddressed: 0,
    changes_requested: 0,
    awaiting_review: 0,
    stale: 0,
    total: 0,
  };

  for (const item of items) {
    counts[item.category] += 1;
    counts.total += 1;
  }

  return {
    repo,
    ...(username && { username }),
    ...(perspective && { perspective }),
    items,
    counts,
  };
}

const CATEGORY_LABELS: Record<ActionableCategory, string> = {
  unaddressed: "Unaddressed Feedback",
  changes_requested: "Changes Requested",
  awaiting_review: "Awaiting Review",
  stale: "Stale PRs",
};

const CATEGORY_ORDER: ActionableCategory[] = [
  "unaddressed",
  "changes_requested",
  "awaiting_review",
  "stale",
];

function formatPrLine(item: ActionableItem): string {
  const branchTrunc = truncate(item.pr_branch, 20);
  const titleTrunc = truncate(item.pr_title, 40);
  return `#${item.pr} [${branchTrunc}] ${titleTrunc}`;
}

function itemsToTreeNodes(items: ActionableItem[], limit = 5): TreeNode[] {
  const nodes: TreeNode[] = [];

  for (const item of items.slice(0, limit)) {
    nodes.push({
      content: formatPrLine(item),
      detail: item.description,
    });
  }

  if (items.length > limit) {
    nodes.push({ content: `+${items.length - limit} more` });
  }

  return nodes;
}

export function printActionableSummary(summary: ActionableSummary): void {
  // Build header
  const headerParts = ["Firewatch", summary.repo];
  if (summary.perspective) {
    const perspectiveLabel =
      summary.perspective === "mine" ? "My PRs" : "To Review";
    headerParts.push(perspectiveLabel);
  }
  headerParts.push(`${summary.counts.total} actionable`);

  const headerLines = renderHeader(headerParts, 50);
  console.log("");
  for (const line of headerLines) {
    console.log(line);
  }

  if (summary.counts.total === 0) {
    console.log("\nAll clear - no actionable items.");
    return;
  }

  // Group items by category
  const byCategory = new Map<ActionableCategory, ActionableItem[]>();
  for (const item of summary.items) {
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }

  // Render each category
  for (const category of CATEGORY_ORDER) {
    const items = byCategory.get(category);
    if (!items || items.length === 0) {
      continue;
    }

    const label = CATEGORY_LABELS[category];
    const treeNodes = itemsToTreeNodes(items);
    const categoryLines = renderCategory(label, items.length, treeNodes);

    console.log("");
    for (const line of categoryLines) {
      console.log(line);
    }
  }
}
