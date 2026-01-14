import { PATHS, readJsonl, writeJsonl } from "./cache";
import { buildWorklist, sortWorklist } from "./worklist";
import { parseSince } from "./time";
import type { FirewatchConfig } from "./schema/config";
import type { FirewatchEntry, SyncMetadata } from "./schema/entry";
import type { WorklistEntry } from "./schema/worklist";
import type {
  AttentionItem,
  LookoutMetadata,
  LookoutSummary,
  UnaddressedFeedback,
} from "./schema/lookout";

const DEFAULT_STALE_THRESHOLD = "1h";
const DEFAULT_FALLBACK_SINCE = "7d";
const STALE_DAYS_THRESHOLD = 3;
const BOT_SUFFIXES = ["[bot]", "-bot"];

// --- Lookout Metadata Management ---

export async function readLookoutMetadata(): Promise<LookoutMetadata[]> {
  const data = await readJsonl<LookoutMetadata>(PATHS.lookout);
  return data;
}

export async function writeLookoutMetadata(
  data: LookoutMetadata[]
): Promise<void> {
  await writeJsonl(PATHS.lookout, data);
}

export async function getLookoutFor(
  repo: string
): Promise<LookoutMetadata | null> {
  const allMeta = await readLookoutMetadata();
  return allMeta.find((m) => m.repo === repo) ?? null;
}

export async function setLookoutFor(
  repo: string,
  timestamp: Date
): Promise<void> {
  const allMeta = await readLookoutMetadata();
  const updated = allMeta.filter((m) => m.repo !== repo);
  updated.push({
    repo,
    last_lookout: timestamp.toISOString(),
  });
  await writeLookoutMetadata(updated);
}

export async function clearLookoutFor(repo: string): Promise<void> {
  const allMeta = await readLookoutMetadata();
  const updated = allMeta.filter((m) => m.repo !== repo);
  await writeLookoutMetadata(updated);
}

// --- Sync Metadata Access ---

export async function getSyncMetadata(
  repo: string
): Promise<SyncMetadata | null> {
  const allMeta = await readJsonl<SyncMetadata>(PATHS.meta);
  return allMeta.find((m) => m.repo === repo) ?? null;
}

// --- Staleness Detection ---

export function isStale(
  lastSync: Date | undefined,
  threshold: string
): boolean {
  if (!lastSync) {
    return true;
  }

  const thresholdMs = parseDurationMs(threshold);
  const now = Date.now();
  const syncAge = now - lastSync.getTime();

  return syncAge > thresholdMs;
}

function parseDurationMs(duration: string): number {
  const match = duration.match(/^(\d+)(h|m|s|d|w)$/);
  if (!match) {
    // Default to 1 hour if invalid
    return 60 * 60 * 1000;
  }

  const value = Number.parseInt(match[1]!, 10);
  const unit = match[2];

  switch (unit) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    case "w":
      return value * 7 * 24 * 60 * 60 * 1000;
    default:
      return 60 * 60 * 1000;
  }
}

// --- Context Building ---

export interface LookoutOptions {
  repo: string;
  since?: Date | undefined;
  reset?: boolean | undefined;
  config: FirewatchConfig;
}

export interface LookoutContext {
  repo: string;
  since: Date;
  until: Date;
  firstRun: boolean;
  syncNeeded: boolean;
  lastSync?: Date | undefined;
}

export async function buildLookoutContext(
  options: LookoutOptions
): Promise<LookoutContext> {
  const now = new Date();
  const syncMeta = await getSyncMetadata(options.repo);
  const lastSync = syncMeta ? new Date(syncMeta.last_sync) : undefined;

  // Determine staleness threshold
  const threshold =
    options.config.lookout_stale_after ?? DEFAULT_STALE_THRESHOLD;
  const syncNeeded = isStale(lastSync, threshold);

  // Handle reset
  if (options.reset) {
    await clearLookoutFor(options.repo);
  }

  // Determine 'since' time
  let since: Date;
  let firstRun = false;

  if (options.since) {
    // Explicit override takes precedence
    since = options.since;
  } else if (options.reset) {
    // Reset requested - use fallback
    since = parseSince(options.config.default_since ?? DEFAULT_FALLBACK_SINCE);
    firstRun = true;
  } else {
    // Try to use last lookout time
    const lookoutMeta = await getLookoutFor(options.repo);
    if (lookoutMeta) {
      since = new Date(lookoutMeta.last_lookout);
    } else {
      // First run - use fallback
      since = parseSince(options.config.default_since ?? DEFAULT_FALLBACK_SINCE);
      firstRun = true;
    }
  }

  return {
    repo: options.repo,
    since,
    until: now,
    firstRun,
    syncNeeded,
    lastSync,
  };
}

// --- Attention Identification ---

function isBot(author: string): boolean {
  return BOT_SUFFIXES.some((suffix) => author.endsWith(suffix));
}

function isStaleItem(lastActivityAt: string): boolean {
  const lastActivity = new Date(lastActivityAt);
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - STALE_DAYS_THRESHOLD);
  return lastActivity < threshold;
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
        // Don't double-count items already in other categories
        (w.review_states?.changes_requested ?? 0) === 0
    )
    .map((w) => toAttentionItem(w, "stale"));

  return { changes_requested, unreviewed, stale };
}

// --- Unaddressed Feedback ---

export function identifyUnaddressedFeedback(
  entries: FirewatchEntry[]
): UnaddressedFeedback[] {
  // Filter to comment entries only
  const commentEntries = entries.filter((e) => e.type === "comment");

  // Group commits by PR for checking if file was addressed
  const commitsByPr = new Map<number, FirewatchEntry[]>();
  for (const entry of entries) {
    if (entry.type === "commit") {
      const existing = commitsByPr.get(entry.pr) ?? [];
      existing.push(entry);
      commitsByPr.set(entry.pr, existing);
    }
  }

  return commentEntries
    .filter((comment) => {
      // Always include issue comments (no file) - they need explicit resolution
      if (!comment.file) {
        // For issue comments, check if there's been any commit after
        const prCommits = commitsByPr.get(comment.pr) ?? [];
        const commentTime = new Date(comment.created_at).getTime();
        const hasLaterCommit = prCommits.some(
          (c) => new Date(c.created_at).getTime() > commentTime
        );
        // Include if no later commit (still needs attention)
        return !hasLaterCommit;
      }

      // For review comments with file tracking, use file_activity_after if available
      if (comment.file_activity_after) {
        return !comment.file_activity_after.modified;
      }

      // Without file_activity_after, check if any commit came after this comment
      const prCommits = commitsByPr.get(comment.pr) ?? [];
      const commentTime = new Date(comment.created_at).getTime();
      const hasLaterCommit = prCommits.some(
        (c) => new Date(c.created_at).getTime() > commentTime
      );
      return !hasLaterCommit;
    })
    .map((e) => ({
      pr: e.pr,
      pr_title: e.pr_title,
      comment_id: e.id,
      author: e.author,
      body: e.body?.slice(0, 200),
      created_at: e.created_at,
      file: e.file,
      line: e.line,
      is_bot: isBot(e.author),
    }));
}

// --- Summary Building ---

export function buildLookoutSummary(
  entries: FirewatchEntry[],
  context: LookoutContext,
  syncedAt?: Date
): LookoutSummary {
  // Build worklist for attention items
  const worklist = sortWorklist(buildWorklist(entries));

  // Count by type
  let comments = 0;
  let reviews = 0;
  let commits = 0;

  for (const entry of entries) {
    switch (entry.type) {
      case "comment":
        comments++;
        break;
      case "review":
        reviews++;
        break;
      case "commit":
        commits++;
        break;
    }
  }

  // Unique PRs
  const uniquePrs = new Set(entries.map((e) => e.pr));

  // Attention items
  const attention = identifyAttentionItems(worklist);

  // Unaddressed feedback
  const unaddressed_feedback = identifyUnaddressedFeedback(entries);

  return {
    repo: context.repo,
    period: {
      since: context.since.toISOString(),
      until: context.until.toISOString(),
    },
    counts: {
      total_entries: entries.length,
      prs_active: uniquePrs.size,
      comments,
      reviews,
      commits,
    },
    attention,
    unaddressed_feedback,
    synced_at: syncedAt?.toISOString(),
    first_run: context.firstRun,
  };
}
