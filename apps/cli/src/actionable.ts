import {
  DEFAULT_BOT_PATTERNS,
  DEFAULT_EXCLUDE_AUTHORS,
  buildWorklist,
  isCommentEntry,
  isReviewComment,
  shouldExcludeAuthor,
  sortWorklist,
  type FirewatchEntry,
  type WorklistEntry,
} from "@outfitter/firewatch-core";

import {
  CATEGORY_ORDER,
  renderCategorySection,
  renderStyledHeader,
  type ActionableCategory,
  type ActionableItem as RenderActionableItem,
} from "./render";
import { getCurrentBranch } from "./utils/git";

export type { ActionableCategory };

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
function isBot(author: string): boolean {
  return shouldExcludeAuthor(author, {
    excludeList: DEFAULT_EXCLUDE_AUTHORS,
    botPatterns: DEFAULT_BOT_PATTERNS,
    excludeBots: true,
  });
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

/**
 * Identify feedback that needs attention.
 *
 * @param entries - Firewatch entries to analyze
 * @param options - Optional filtering options
 * @param options.ackedIds - Set of comment IDs that have been acknowledged (will be excluded)
 * @param options.username - Logged-in user's GitHub username (for thumbs-up acknowledgment check)
 * @param options.commitImpliesRead - Treat comments as read if user committed after (opt-in)
 * @param options.prStates - PR states to include (defaults to ["open", "draft"])
 * @returns Array of unaddressed feedback items
 */
export function identifyUnaddressedFeedback(
  entries: FirewatchEntry[],
  options?: {
    ackedIds?: Set<string> | undefined;
    username?: string | undefined;
    commitImpliesRead?: boolean | undefined;
    prStates?: Set<string> | undefined;
  }
): UnaddressedFeedback[] {
  const ackedIds = options?.ackedIds;
  const username = options?.username;
  const commitImpliesRead = options?.commitImpliesRead ?? false;
  // Default to open/draft PRs (actionable feedback), but allow override for bulk-ack scenarios
  const allowedStates = options?.prStates ?? new Set(["open", "draft"]);

  // Filter to comments on allowed PR states
  const commentEntries = entries.filter(
    (e) => isCommentEntry(e) && allowedStates.has(e.pr_state)
  );

  // Build commit lookup only if commitImpliesRead is enabled
  const commitsByRepoPr = new Map<string, FirewatchEntry[]>();
  if (commitImpliesRead && username) {
    // Filter commits to only those by the logged-in user
    const usernameLower = username.toLowerCase();
    for (const entry of entries) {
      if (entry.type === "commit") {
        // Only count commits from the logged-in user
        const authorLogin = entry.author_login?.toLowerCase();
        if (authorLogin === usernameLower) {
          const key = `${entry.repo}:${entry.pr}`;
          const existing = commitsByRepoPr.get(key) ?? [];
          existing.push(entry);
          commitsByRepoPr.set(key, existing);
        }
      }
    }
  }
  const hasLaterCommit = (
    repo: string,
    pr: number,
    createdAt: string
  ): boolean => {
    if (!commitImpliesRead || !username) {
      return false;
    }
    const key = `${repo}:${pr}`;
    const prCommits = commitsByRepoPr.get(key) ?? [];
    const time = new Date(createdAt).getTime();
    return prCommits.some((c) => new Date(c.created_at).getTime() > time);
  };

  return commentEntries
    .filter((comment) => {
      // Ignore self-comments from the PR author
      if (comment.author.toLowerCase() === comment.pr_author.toLowerCase()) {
        return false;
      }

      // For review comments, prefer thread_resolved from GitHub
      // But check acks as fallback - after `fw close` resolves a thread,
      // the ack record exists but thread_resolved won't be true until next sync
      if (isReviewComment(comment)) {
        if (comment.thread_resolved === true) {
          return false; // resolved on GitHub
        }
        if (ackedIds?.has(comment.id)) {
          return false; // locally acked (just resolved, awaiting sync)
        }
        return true; // unaddressed
      }

      // === Issue comment handling below ===

      // Exclude acknowledged issue comments (local workaround for missing GitHub resolve)
      if (ackedIds?.has(comment.id)) {
        return false;
      }

      // Treat 👍 from logged-in user as acknowledgement (issue comments only)
      if (username && comment.reactions?.thumbs_up_by?.length) {
        const acked = comment.reactions.thumbs_up_by.some(
          (login) => login.toLowerCase() === username.toLowerCase()
        );
        if (acked) {
          return false;
        }
      }

      // Use file_activity_after when available (targeted signal for file-specific comments)
      if (comment.file_activity_after) {
        return !comment.file_activity_after.modified;
      }

      // Opt-in: treat comments as read if user committed after
      if (commitImpliesRead) {
        return !hasLaterCommit(comment.repo, comment.pr, comment.created_at);
      }

      // No explicit resolution signal - treat as unaddressed (conservative default)
      return true;
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
        !unaddressedItems.some((i) => i.repo === item.repo && i.pr === item.pr)
    )
    .map(
      (item): ActionableItem => ({
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
      })
    );

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
  const staleItems = attention.stale.map(
    (item): ActionableItem => ({
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
    })
  );

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
  includeOrphaned = false,
  options: {
    ackedIds?: Set<string>;
    commitImpliesRead?: boolean;
  } = {}
): ActionableSummary {
  const worklist = sortWorklist(buildWorklist(entries));
  const attention = identifyAttentionItems(worklist);
  const unaddressedFeedback = identifyUnaddressedFeedback(entries, {
    ackedIds: options.ackedIds,
    username,
    commitImpliesRead: options.commitImpliesRead,
  });
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

export async function printActionableSummary(
  summary: ActionableSummary
): Promise<void> {
  // Build header parts
  const headerParts = ["Firewatch", summary.repo];
  if (summary.perspective) {
    const perspectiveLabel =
      summary.perspective === "mine" ? "My PRs" : "To Review";
    headerParts.push(perspectiveLabel);
  }

  // Render styled header with count
  const headerLines = renderStyledHeader(headerParts, {
    width: 50,
    count: summary.counts.total,
  });
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

    // Map to render items format
    const renderItems: RenderActionableItem[] = items.map((item) => ({
      pr: item.pr,
      pr_branch: item.pr_branch,
      pr_title: item.pr_title,
      description: item.description,
    }));

    const categoryLines = renderCategorySection(category, renderItems, {
      currentBranch,
    });

    console.log("");
    for (const line of categoryLines) {
      console.log(line);
    }
  }
}
