import { ensureDirectories, getDatabase } from "./cache";
import type { GitHubClient, PRNode } from "./github";
import type { FirewatchPlugin } from "./plugins/types";
import {
  getSyncMeta,
  insertEntries,
  setSyncMeta,
  upsertPR,
  type PRMetadata,
} from "./repository";
import type { FirewatchEntry, SyncMetadata } from "./schema/entry";

/**
 * Map GitHub PR state to Firewatch state (for entries).
 * Includes draft as a state for backward compatibility with JSONL.
 */
function mapPRState(
  state: "OPEN" | "CLOSED" | "MERGED",
  isDraft: boolean
): FirewatchEntry["pr_state"] {
  if (isDraft) {
    return "draft";
  }
  if (state === "MERGED") {
    return "merged";
  }
  if (state === "CLOSED") {
    return "closed";
  }
  return "open";
}

/**
 * Map GitHub PR state to database state.
 * The database stores state and isDraft separately, so this only returns
 * the core state without considering draft status.
 */
function mapPRStateForDb(
  state: "OPEN" | "CLOSED" | "MERGED",
  merged?: boolean
): PRMetadata["state"] {
  // GitHub can return MERGED state directly, or we can check the merged flag
  if (state === "MERGED" || merged) {
    return "merged";
  }
  if (state === "CLOSED") {
    return "closed";
  }
  return "open";
}

/**
 * Convert a PR node to Firewatch entries.
 */
interface PrContext {
  repo: string;
  pr: number;
  pr_title: string;
  pr_state: FirewatchEntry["pr_state"];
  pr_author: string;
  pr_branch: string;
  pr_labels?: string[];
}

function buildPrContext(repo: string, pr: PRNode): PrContext {
  const labels = pr.labels.nodes.map((l) => l.name);
  return {
    repo,
    pr: pr.number,
    pr_title: pr.title,
    pr_state: mapPRState(pr.state, pr.isDraft),
    pr_author: pr.author?.login ?? "unknown",
    pr_branch: pr.headRefName,
    ...(labels.length > 0 && { pr_labels: labels }),
  };
}

function reviewEntries(
  pr: PRNode,
  prContext: PrContext,
  capturedAt: string
): FirewatchEntry[] {
  return pr.reviews.nodes.map((review) => ({
    ...prContext,
    id: review.id,
    type: "review",
    author: review.author?.login ?? "unknown",
    body: review.body || undefined,
    state: review.state.toLowerCase(),
    created_at: review.createdAt,
    updated_at: review.updatedAt,
    captured_at: capturedAt,
    url: pr.url,
  }));
}

function issueCommentEntries(
  pr: PRNode,
  prContext: PrContext,
  capturedAt: string
): FirewatchEntry[] {
  return pr.comments.nodes.map((comment) => ({
    ...prContext,
    id: comment.id,
    type: "comment",
    subtype: "issue_comment",
    author: comment.author?.login ?? "unknown",
    body: comment.body,
    created_at: comment.createdAt,
    updated_at: comment.updatedAt,
    captured_at: capturedAt,
    url: pr.url,
  }));
}

function reviewThreadEntries(
  pr: PRNode,
  prContext: PrContext,
  capturedAt: string
): FirewatchEntry[] {
  const entries: FirewatchEntry[] = [];
  for (const thread of pr.reviewThreads.nodes) {
    for (const comment of thread.comments.nodes) {
      entries.push({
        ...prContext,
        id: comment.id,
        type: "comment",
        subtype: "review_comment",
        author: comment.author?.login ?? "unknown",
        body: comment.body,
        created_at: comment.createdAt,
        updated_at: comment.updatedAt,
        captured_at: capturedAt,
        url: pr.url,
        file: thread.path,
        line: thread.line ?? undefined,
        // Track thread resolution state for orphaned comment detection
        thread_resolved: thread.isResolved,
      });
    }
  }
  return entries;
}

function commitEntries(
  pr: PRNode,
  prContext: PrContext,
  capturedAt: string
): FirewatchEntry[] {
  return pr.commits.nodes.map(({ commit }) => ({
    ...prContext,
    id: commit.oid,
    type: "commit",
    author: commit.author?.name ?? commit.author?.email ?? "unknown",
    body: commit.message,
    created_at: commit.committedDate,
    captured_at: capturedAt,
  }));
}

function prToEntries(
  repo: string,
  pr: PRNode,
  capturedAt: string
): FirewatchEntry[] {
  const prContext = buildPrContext(repo, pr);
  return [
    ...reviewEntries(pr, prContext, capturedAt),
    ...issueCommentEntries(pr, prContext, capturedAt),
    ...reviewThreadEntries(pr, prContext, capturedAt),
    ...commitEntries(pr, prContext, capturedAt),
  ];
}

/**
 * Sync options.
 */
export interface SyncOptions {
  /** Force full refresh (ignore cursor) */
  full?: boolean;

  /** Only sync PRs updated since this date */
  since?: Date;

  /** Plugins to run during sync */
  plugins?: FirewatchPlugin[];
}

/**
 * Sync result.
 */
export interface SyncResult {
  repo: string;
  entriesAdded: number;
  prsProcessed: number;
  cursor: string | null;
}

/**
 * Build PR metadata from a GitHub PR node for SQLite storage.
 */
function buildPRMetadata(repo: string, pr: PRNode): PRMetadata {
  return {
    repo,
    number: pr.number,
    nodeId: undefined, // PR node doesn't include node ID in current query
    state: mapPRStateForDb(pr.state),
    isDraft: pr.isDraft,
    title: pr.title,
    author: pr.author?.login,
    branch: pr.headRefName,
    labels: pr.labels.nodes.map((l) => l.name),
    updatedAt: pr.updatedAt,
  };
}

/**
 * Load sync metadata from SQLite.
 */
function loadSyncMeta(
  db: ReturnType<typeof getDatabase>,
  repo: string
): SyncMetadata | null {
  return getSyncMeta(db, repo);
}

/**
 * Process a single PR: build metadata and entries, run plugins.
 */
async function processPR(
  repo: string,
  pr: PRNode,
  capturedAt: string,
  plugins?: FirewatchPlugin[]
): Promise<{ metadata: PRMetadata; entries: FirewatchEntry[] }> {
  const metadata = buildPRMetadata(repo, pr);
  let entries = prToEntries(repo, pr, capturedAt);

  if (plugins) {
    for (const plugin of plugins) {
      if (plugin.enrich) {
        entries = await Promise.all(entries.map((e) => plugin.enrich!(e)));
      }
    }
  }

  return { metadata, entries };
}

/**
 * Write batch to SQLite (PR metadata + entries) in a transaction.
 */
function writeBatchToSQLite(
  db: ReturnType<typeof getDatabase>,
  prMetadataList: PRMetadata[],
  entries: FirewatchEntry[]
): void {
  db.transaction(() => {
    for (const prMeta of prMetadataList) {
      upsertPR(db, prMeta);
    }
    insertEntries(db, entries);
  })();
}

/**
 * Update sync metadata in SQLite.
 */
function updateSyncMetadata(
  db: ReturnType<typeof getDatabase>,
  meta: SyncMetadata
): void {
  setSyncMeta(db, meta);
}

/**
 * Sync a repository's PR activity.
 *
 * Writes to SQLite database with PR metadata updates on every sync,
 * fixing Issue #37 (stale PR state).
 */
export async function syncRepo(
  client: GitHubClient,
  repo: string,
  options: SyncOptions = {}
): Promise<SyncResult> {
  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) {
    throw new Error(`Invalid repo format: ${repo}. Expected owner/repo`);
  }

  await ensureDirectories();

  const capturedAt = new Date().toISOString();
  const db = getDatabase();
  const syncMeta = loadSyncMeta(db, repo);
  const cursor = options.full ? null : (syncMeta?.cursor ?? null);

  let entriesAdded = 0;
  let prsProcessed = 0;
  let currentCursor = cursor;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = await client.fetchPRActivity(owner, repoName, {
      first: 50,
      after: currentCursor,
      states: ["OPEN", "CLOSED"],
    });

    const { nodes, pageInfo } = data.repository.pullRequests;
    const prMetadataList: PRMetadata[] = [];
    const allEntries: FirewatchEntry[] = [];

    for (const pr of nodes) {
      if (options.since && new Date(pr.updatedAt) < options.since) {
        hasNextPage = false;
        break;
      }

      const { metadata, entries } = await processPR(
        repo,
        pr,
        capturedAt,
        options.plugins
      );
      prMetadataList.push(metadata);
      allEntries.push(...entries);
      prsProcessed++;
    }

    // Write to SQLite (updates PR state on every sync)
    writeBatchToSQLite(db, prMetadataList, allEntries);
    entriesAdded += allEntries.length;

    hasNextPage = pageInfo.hasNextPage && hasNextPage;
    currentCursor = pageInfo.endCursor;
  }

  const newMeta: SyncMetadata = {
    repo,
    last_sync: capturedAt,
    cursor: currentCursor ?? undefined,
    pr_count: (syncMeta?.pr_count ?? 0) + prsProcessed,
  };

  updateSyncMetadata(db, newMeta);

  return {
    repo,
    entriesAdded,
    prsProcessed,
    cursor: currentCursor,
  };
}
