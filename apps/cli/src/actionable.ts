import {
  buildWorklist,
  sortWorklist,
  type FirewatchEntry,
  type WorklistEntry,
} from "@outfitter/firewatch-core";

import { c, getAnsis } from "./utils/color";
import { getCurrentBranch } from "./utils/git";
import { renderHeader } from "./utils/tree";

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
    .filter(
      (w) =>
        (w.pr_state === "open" || w.pr_state === "draft") &&
        (w.review_states?.changes_requested ?? 0) > 0
    )
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
      // For review comments, thread_resolved is the authoritative signal
      // If we have thread resolution state, use it directly
      if (comment.thread_resolved !== undefined) {
        return !comment.thread_resolved;
      }

      // Fallback heuristics when thread_resolved is not available
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
  unaddressedFeedback: UnaddressedFeedback[],
  includeOrphaned = false
): ActionableItem[] {
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

    const existing = feedbackByRepoPr.get(key);
    if (existing) {
      existing.push(fb);
    } else {
      feedbackByRepoPr.set(key, [fb]);
    }
  }

  // Build unaddressed feedback items
  const unaddressedItems: ActionableItem[] = [];
  for (const [key, feedbacks] of feedbackByRepoPr) {
    const entry = entryByRepoPr.get(key);
    if (!entry) {
      continue;
    }

    // Only show unaddressed feedback for open/draft PRs (unless orphaned mode)
    const isOpenOrDraft =
      entry.pr_state === "open" || entry.pr_state === "draft";
    if (!isOpenOrDraft && !includeOrphaned) {
      continue;
    }

    unaddressedItems.push({
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

  // Build changes_requested items (excluding PRs already in unaddressed)
  const changesRequestedItems = attention.changes_requested
    .filter(
      (item) =>
        !unaddressedItems.some(
          (i) => i.repo === item.repo && i.pr === item.pr
        )
    )
    .map((item): ActionableItem => ({
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
    }));

  // Build awaiting_review items
  const awaitingReviewItems = attention.unreviewed.map(
    (item): ActionableItem => ({
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
    })
  );

  // Build stale items
  const staleItems = attention.stale.map((item): ActionableItem => ({
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
  }));

  return [
    ...unaddressedItems,
    ...changesRequestedItems,
    ...awaitingReviewItems,
    ...staleItems,
  ];
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
  username?: string,
  includeOrphaned = false
): ActionableSummary {
  const worklist = sortWorklist(buildWorklist(entries));
  const attention = identifyAttentionItems(worklist);
  const unaddressedFeedback = identifyUnaddressedFeedback(entries);
  let items = buildActionableItems(
    entries,
    attention,
    unaddressedFeedback,
    includeOrphaned
  );
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
  unaddressed: "Awaiting Feedback",
  changes_requested: "Changes Requested",
  awaiting_review: "Awaiting Review",
  stale: "Stale",
};

const CATEGORY_ORDER: ActionableCategory[] = [
  "unaddressed",
  "changes_requested",
  "awaiting_review",
  "stale",
];

// Glyphs by category
const GLYPHS = {
  unaddressed: { current: "◉", other: "◎" },
  changes_requested: { current: "◉", other: "◎" },
  awaiting_review: { current: "◯", other: "◯" },
  stale: { current: "◌", other: "◌" },
} as const;

type ColorFn = (text: string) => string;

const CATEGORY_COLORS: Record<ActionableCategory, ColorFn> = {
  unaddressed: c.yellow,
  changes_requested: c.white,
  awaiting_review: c.cyan,
  stale: c.white,
};

function formatCategoryHeader(
  label: string,
  count: number,
  color: ColorFn
): string {
  const a = getAnsis();
  const prLabel = count === 1 ? "PR" : "PRs";
  return `${color(a.bold(`${label}:`))} ${color(`${count} ${prLabel}`)}`;
}

function formatPrLine(
  item: ActionableItem,
  category: ActionableCategory,
  currentBranch: string | null
): string {
  const isCurrent = currentBranch === item.pr_branch;
  const glyph = isCurrent ? GLYPHS[category].current : GLYPHS[category].other;
  const color = CATEGORY_COLORS[category];
  return color(`${glyph} #${item.pr} ${item.pr_branch}`);
}

function formatDetailLine(item: ActionableItem): string | null {
  // Skip generic status messages - not useful info
  if (
    item.description === "Awaiting first review" ||
    item.description === "No recent activity" ||
    item.description === "Changes requested"
  ) {
    return null;
  }
  // Format authors with @ prefix
  const detail = item.description.replaceAll(
    /\b([a-zA-Z0-9_-]+) \((\d+)\)/g,
    "@$1 ($2)"
  );
  return c.dim(`  ⎿ ${detail}`);
}

function renderCategorySection(
  category: ActionableCategory,
  items: ActionableItem[],
  currentBranch: string | null,
  limit = 5
): string[] {
  const color = CATEGORY_COLORS[category];
  const label = CATEGORY_LABELS[category];
  const lines: string[] = [formatCategoryHeader(label, items.length, color)];

  for (const item of items.slice(0, limit)) {
    lines.push(formatPrLine(item, category, currentBranch));
    const detail = formatDetailLine(item);
    if (detail) {
      lines.push(detail);
    }
  }

  if (items.length > limit) {
    const glyph = GLYPHS[category].other;
    lines.push(c.dim(`${glyph} +${items.length - limit} more`));
  }

  return lines;
}

export async function printActionableSummary(
  summary: ActionableSummary
): Promise<void> {
  // Build header
  const headerParts = ["Firewatch", summary.repo];
  if (summary.perspective) {
    const perspectiveLabel =
      summary.perspective === "mine" ? "My PRs" : "To Review";
    headerParts.push(perspectiveLabel);
  }

  const headerLines = renderHeader(headerParts, 50);
  console.log("");
  for (const line of headerLines) {
    console.log(line);
  }

  if (summary.counts.total === 0) {
    console.log("\nAll clear - no actionable items.");
    return;
  }

  // Get current branch for highlighting
  const currentBranch = await getCurrentBranch();

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

    const categoryLines = renderCategorySection(category, items, currentBranch);

    console.log("");
    for (const line of categoryLines) {
      console.log(line);
    }
  }
}
