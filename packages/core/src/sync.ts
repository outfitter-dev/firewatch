import { ensureDirectories, getDatabase } from "./cache";
import type { GitHubClient, GitHubPRState, PRNode } from "./github";
import type { FirewatchPlugin } from "./plugins/types";
import {
  getSyncMeta,
  insertEntries,
  setSyncMeta,
  upsertPR,
  upsertPRs,
  type PRMetadata,
} from "./repository";
import type {
  CommentReactions,
  FirewatchEntry,
  SyncScope,
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

  /** Which PR scope to sync (default: open) */
  scope?: SyncScope;

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
  scope: SyncScope;
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
  repo: string,
  scope: SyncScope
): SyncMetadata | null {
  return getSyncMeta(db, repo, scope);
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

function resolveSyncStates(scope: SyncScope): GitHubPRState[] {
  return scope === "open"
    ? (["OPEN"] satisfies GitHubPRState[])
    : (["CLOSED", "MERGED"] satisfies GitHubPRState[]);
}

function resolveSyncWindow(
  options: SyncOptions,
  syncMeta: SyncMetadata | null
): {
  syncSince: Date | undefined;
  useTimeWindow: boolean;
  cursor: string | null;
} {
  const syncSince =
    options.since ??
    (!options.full && syncMeta?.last_sync
      ? new Date(syncMeta.last_sync)
      : undefined);
  const useTimeWindow = Boolean(syncSince);
  const cursor =
    options.full || useTimeWindow ? null : (syncMeta?.cursor ?? null);

  return { syncSince, useTimeWindow, cursor };
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

interface SyncContext {
  client: GitHubClient;
  owner: string;
  repoName: string;
  repo: string;
  capturedAt: string;
  db: ReturnType<typeof getDatabase>;
  syncSince: Date | undefined;
  states: GitHubPRState[];
  plugins?: FirewatchPlugin[];
}

interface SyncPageResult {
  prMetadataList: PRMetadata[];
  entries: FirewatchEntry[];
  prsProcessed: number;
  stopEarly: boolean;
  endCursor: string | null;
  hasNextPage: boolean;
}

async function fetchSyncPage(
  context: SyncContext,
  cursor: string | null
): Promise<SyncPageResult> {
  const data = await context.client.fetchPRActivity(
    context.owner,
    context.repoName,
    {
      first: 50,
      after: cursor,
      states: context.states,
    }
  );

  if (data.isErr()) {
    throw data.error;
  }

  const { nodes, pageInfo } = data.value.repository.pullRequests;
  const prMetadataList: PRMetadata[] = [];
  const allEntries: FirewatchEntry[] = [];
  let prsProcessed = 0;
  let stopEarly = false;

  for (const pr of nodes) {
    if (context.syncSince && new Date(pr.updatedAt) < context.syncSince) {
      stopEarly = true;
      break;
    }

    const { metadata, entries } = await processPR(
      context.repo,
      pr,
      context.capturedAt
    );
    prMetadataList.push(metadata);
    allEntries.push(...entries);
    prsProcessed++;
  }

  return {
    prMetadataList,
    entries: allEntries,
    prsProcessed,
    stopEarly,
    endCursor: pageInfo.endCursor,
    hasNextPage: pageInfo.hasNextPage,
  };
}

async function enrichEntries(
  client: GitHubClient,
  entries: FirewatchEntry[],
  plugins?: FirewatchPlugin[]
): Promise<FirewatchEntry[]> {
  if (entries.length === 0) {
    return entries;
  }

  const commentIds = entries
    .filter((entry) => entry.type === "comment")
    .map((entry) => entry.id);
  const reactionsResult = await client.fetchCommentReactions(commentIds);
  if (reactionsResult.isErr()) {
    throw reactionsResult.error;
  }
  let entriesToWrite = applyCommentReactions(entries, reactionsResult.value);

  if (plugins) {
    for (const plugin of plugins) {
      if (plugin.enrich) {
        entriesToWrite = await Promise.all(
          entriesToWrite.map((entry) => plugin.enrich!(entry))
        );
      }
    }
  }

  return entriesToWrite;
}

async function syncAllPages(
  context: SyncContext,
  initialCursor: string | null
): Promise<{
  entriesAdded: number;
  prsProcessed: number;
  cursor: string | null;
}> {
  let entriesAdded = 0;
  let prsProcessed = 0;
  let currentCursor = initialCursor;
  let hasNextPage = true;

  while (hasNextPage) {
    const page = await fetchSyncPage(context, currentCursor);
    const entriesToWrite = await enrichEntries(
      context.client,
      page.entries,
      context.plugins
    );

    if (page.prMetadataList.length > 0 || entriesToWrite.length > 0) {
      writeBatchToSQLite(context.db, page.prMetadataList, entriesToWrite);
      entriesAdded += entriesToWrite.length;
    }

    prsProcessed += page.prsProcessed;
    hasNextPage = page.hasNextPage && !page.stopEarly;
    currentCursor = page.endCursor;
  }

  return { entriesAdded, prsProcessed, cursor: currentCursor };
}

/**
 * Update PR metadata for recently closed/merged PRs.
 *
 * When syncing open PRs incrementally, closed PRs won't appear in the open
 * query, so we do a lightweight closed/merged pass to keep state accurate.
 */
async function updateClosedPRsSince(
  client: GitHubClient,
  owner: string,
  repoName: string,
  repo: string,
  syncSince: Date,
  db: ReturnType<typeof getDatabase>
): Promise<number> {
  let updated = 0;
  let closedCursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = await client.fetchPRActivity(owner, repoName, {
      first: 50,
      after: closedCursor,
      states: ["CLOSED", "MERGED"],
    });

    if (data.isErr()) {
      throw data.error;
    }

    const { nodes, pageInfo } = data.value.repository.pullRequests;
    const prMetadataList: PRMetadata[] = [];

    for (const pr of nodes) {
      if (new Date(pr.updatedAt) < syncSince) {
        hasNextPage = false;
        break;
      }

      prMetadataList.push(buildPRMetadata(repo, pr));
    }

    if (prMetadataList.length > 0) {
      upsertPRs(db, prMetadataList);
      updated += prMetadataList.length;
    }

    hasNextPage = pageInfo.hasNextPage && hasNextPage;
    closedCursor = pageInfo.endCursor;
  }

  return updated;
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

  const scope = options.scope ?? "open";
  await ensureDirectories();

  const capturedAt = new Date().toISOString();
  const db = getDatabase();
  const syncMeta = loadSyncMeta(db, repo, scope);
  const { syncSince, useTimeWindow, cursor } = resolveSyncWindow(
    options,
    syncMeta
  );
  const states = resolveSyncStates(scope);
  const context: SyncContext = {
    client,
    owner,
    repoName,
    repo,
    capturedAt,
    db,
    syncSince,
    states,
    ...(options.plugins && { plugins: options.plugins }),
  };
  const {
    entriesAdded,
    prsProcessed,
    cursor: currentCursor,
  } = await syncAllPages(context, cursor);

  if (scope === "open" && syncSince && !options.full) {
    await updateClosedPRsSince(client, owner, repoName, repo, syncSince, db);
  }

  // Cursor is only meaningful for cursor-based syncs (no time window).
  const storedCursor = useTimeWindow ? undefined : (currentCursor ?? undefined);
  const newMeta: SyncMetadata = {
    repo,
    scope,
    last_sync: capturedAt,
    cursor: storedCursor,
    pr_count: (syncMeta?.pr_count ?? 0) + prsProcessed,
  };

  updateSyncMetadata(db, newMeta);

  return {
    repo,
    scope,
    entriesAdded,
    prsProcessed,
    cursor: currentCursor,
  };
}
