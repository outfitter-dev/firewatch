import { ensureDirectories, getDatabase } from "./cache";
import type { GitHubClient, GitHubPRState, PRNode } from "./github";
import type { FirewatchPlugin } from "./plugins/types";
import {
  getSyncMeta,
  insertEntries,
  setSyncMeta,
  upsertPR,
  type PRMetadata,
} from "./repository";
import type {
  CommentReactions,
  FirewatchEntry,
  SyncMetadata,
} from "./schema/entry";

/**
 * Map GitHub PR state to Firewatch state (for entries).
 * Includes draft as a state for backward compatibility with JSONL.
 *
 * GitHub states: OPEN, CLOSED, MERGED (defined in GITHUB_PR_STATES)
 * Firewatch states: open, closed, merged, draft
 */
function mapPRState(
  state: GitHubPRState,
  isDraft: boolean
): FirewatchEntry["pr_state"] {
  if (state === "MERGED") {
    return "merged";
  }
  if (state === "CLOSED") {
    return "closed";
  }
  if (isDraft) {
    return "draft";
  }
  return "open";
}

/**
 * Map GitHub PR state to database state.
 * The database stores state and isDraft separately, so this only returns
 * the core state without considering draft status.
 *
 * GitHub states: OPEN, CLOSED, MERGED (defined in GITHUB_PR_STATES)
 * Database states: open, closed, merged
 */
function mapPRStateForDb(
  state: GitHubPRState,
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

function applyCommentReactions(
  entries: FirewatchEntry[],
  reactionsById: Map<string, CommentReactions>
): FirewatchEntry[] {
  if (reactionsById.size === 0) {
    return entries;
  }

  return entries.map((entry) => {
    if (entry.type !== "comment") {
      return entry;
    }

    const reactions = reactionsById.get(entry.id);
    return reactions ? { ...entry, reactions } : entry;
  });
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
    database_id: comment.databaseId,
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
        database_id: comment.databaseId,
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
  return pr.commits.nodes.map(({ commit }) => {
    const entry: FirewatchEntry = {
      ...prContext,
      id: commit.oid,
      type: "commit",
      author: commit.author?.name ?? commit.author?.email ?? "unknown",
      body: commit.message,
      created_at: commit.committedDate,
      captured_at: capturedAt,
    };
    // Include GitHub login if commit author has a linked account
    const login = commit.author?.user?.login;
    if (login) {
      entry.author_login = login;
    }
    return entry;
  });
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
  /** Force full sync (ignore incremental window) */
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
function processPR(
  repo: string,
  pr: PRNode,
  capturedAt: string
): { metadata: PRMetadata; entries: FirewatchEntry[] } {
  const metadata = buildPRMetadata(repo, pr);
  const entries = prToEntries(repo, pr, capturedAt);

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
  const syncSince =
    options.since ??
    (!options.full && syncMeta?.last_sync
      ? new Date(syncMeta.last_sync)
      : undefined);
  const useTimeWindow = Boolean(syncSince);
  const cursor = options.full || useTimeWindow ? null : (syncMeta?.cursor ?? null);

  let entriesAdded = 0;
  let prsProcessed = 0;
  let currentCursor = cursor;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = await client.fetchPRActivity(owner, repoName, {
      first: 50,
      after: currentCursor,
      // Uses GITHUB_PR_STATES default (OPEN, CLOSED, MERGED)
    });

    const { nodes, pageInfo } = data.repository.pullRequests;
    const prMetadataList: PRMetadata[] = [];
    const allEntries: FirewatchEntry[] = [];

    for (const pr of nodes) {
      if (syncSince && new Date(pr.updatedAt) < syncSince) {
        hasNextPage = false;
        break;
      }

      const { metadata, entries } = await processPR(repo, pr, capturedAt);
      prMetadataList.push(metadata);
      allEntries.push(...entries);
      prsProcessed++;
    }

    const commentIds = allEntries
      .filter((entry) => entry.type === "comment")
      .map((entry) => entry.id);
    const reactionsById = await client.fetchCommentReactions(commentIds);
    let entriesToWrite = applyCommentReactions(allEntries, reactionsById);

    if (options.plugins) {
      for (const plugin of options.plugins) {
        if (plugin.enrich) {
          entriesToWrite = await Promise.all(
            entriesToWrite.map((entry) => plugin.enrich!(entry))
          );
        }
      }
    }

    // Write to SQLite (updates PR state on every sync)
    writeBatchToSQLite(db, prMetadataList, entriesToWrite);
    entriesAdded += entriesToWrite.length;

    hasNextPage = pageInfo.hasNextPage && hasNextPage;
    currentCursor = pageInfo.endCursor;
  }

  // Cursor is only meaningful for cursor-based syncs (no time window).
  const storedCursor = useTimeWindow ? undefined : currentCursor ?? undefined;
  const newMeta: SyncMetadata = {
    repo,
    last_sync: capturedAt,
    cursor: storedCursor,
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
