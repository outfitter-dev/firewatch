/**
 * Repository layer for Firewatch SQLite database.
 *
 * Provides type-safe CRUD operations for entries, PRs, and sync metadata.
 * All operations use prepared statements for safety and performance.
 */
import type { Database, Statement } from "bun:sqlite";

import { DEFAULT_BOT_PATTERNS, isBot, isExcludedAuthor } from "./authors";
import type { QueryFilters } from "./query";
import type {
  EntryType,
  FileActivityAfter,
  CommentReactions,
  FileProvenance,
  FirewatchEntry,
  GraphiteMetadata,
  PrState,
  SyncScope,
  SyncMetadata,
} from "./schema/entry";

// =============================================================================
// Types
// =============================================================================

/**
 * PR metadata stored in the database (mutable state).
 * This is the source of truth for PR state, updated on each sync.
 */
export interface PRMetadata {
  repo: string;
  number: number;
  nodeId?: string | undefined;
  state: "open" | "closed" | "merged";
  isDraft: boolean;
  title?: string | undefined;
  author?: string | undefined;
  branch?: string | undefined;
  labels: string[];
  updatedAt?: string | undefined;
}

/**
 * Database row type for entries table.
 * JSON fields are stored as TEXT.
 */
interface EntryRow {
  id: string;
  repo: string;
  pr: number;
  type: EntryType;
  subtype: string | null;
  author: string;
  body: string | null;
  state: string | null;
  created_at: string;
  updated_at: string | null;
  captured_at: string;
  url: string | null;
  file: string | null;
  line: number | null;
  thread_resolved: number | null;
  graphite_json: string | null;
  file_activity_json: string | null;
  file_provenance_json: string | null;
  reactions_json: string | null;
}

/**
 * Database row type for prs table.
 */
interface PRRow {
  repo: string;
  number: number;
  node_id: string | null;
  state: string;
  is_draft: number;
  title: string | null;
  author: string | null;
  branch: string | null;
  labels: string | null;
  updated_at: string | null;
}

/**
 * Database row type for sync_meta table.
 */
interface SyncMetaRow {
  repo: string;
  cursor: string | null;
  last_sync: string;
  pr_count: number;
  cursor_open: string | null;
  cursor_closed: string | null;
  last_sync_open: string | null;
  last_sync_closed: string | null;
  pr_count_open: number;
  pr_count_closed: number;
}

const SYNC_SCOPE_COLUMNS: Record<
  SyncScope,
  {
    cursor: "cursor_open" | "cursor_closed";
    lastSync: "last_sync_open" | "last_sync_closed";
    prCount: "pr_count_open" | "pr_count_closed";
  }
> = {
  open: {
    cursor: "cursor_open",
    lastSync: "last_sync_open",
    prCount: "pr_count_open",
  },
  closed: {
    cursor: "cursor_closed",
    lastSync: "last_sync_closed",
    prCount: "pr_count_closed",
  },
};

/**
 * Joined row type for entry queries with PR data.
 */
interface EntryWithPRRow extends EntryRow {
  pr_state: string;
  pr_is_draft: number;
  pr_title: string | null;
  pr_author: string | null;
  pr_branch: string | null;
  pr_labels: string | null;
  reactions_json: string | null;
}

/**
 * Partial updates for entries (e.g., file activity updates).
 */
export interface EntryUpdates {
  body?: string;
  state?: string;
  updated_at?: string;
  file_activity_after?: FileActivityAfter;
}

// =============================================================================
// Prepared Statement Cache
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Bun's SQLite types are too strict for dynamic bindings
type AnyStatement = Statement<any, any>;

const statementCache = new WeakMap<Database, Map<string, AnyStatement>>();

/**
 * Get or create a prepared statement for the given database and SQL.
 */
function getStatement(db: Database, name: string, sql: string): AnyStatement {
  let cache = statementCache.get(db);
  if (!cache) {
    cache = new Map();
    statementCache.set(db, cache);
  }

  let stmt = cache.get(name);
  if (!stmt) {
    stmt = db.prepare(sql);
    cache.set(name, stmt);
  }
  return stmt;
}

// =============================================================================
// Conversion Functions
// =============================================================================

/**
 * Serialize thread_resolved boolean to SQLite integer.
 * true -> 1, false -> 0, undefined -> null
 */
function serializeThreadResolved(value: boolean | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  return value ? 1 : 0;
}

/**
 * Convert a FirewatchEntry to a database row.
 * Serializes nested objects to JSON.
 */
function entryToRow(entry: FirewatchEntry): EntryRow {
  const threadResolved = serializeThreadResolved(entry.thread_resolved);

  return {
    id: entry.id,
    repo: entry.repo,
    pr: entry.pr,
    type: entry.type,
    subtype: entry.subtype ?? null,
    author: entry.author,
    body: entry.body ?? null,
    state: entry.state ?? null,
    created_at: entry.created_at,
    updated_at: entry.updated_at ?? null,
    captured_at: entry.captured_at,
    url: entry.url ?? null,
    file: entry.file ?? null,
    line: entry.line ?? null,
    thread_resolved: threadResolved,
    graphite_json: entry.graphite ? JSON.stringify(entry.graphite) : null,
    file_activity_json: entry.file_activity_after
      ? JSON.stringify(entry.file_activity_after)
      : null,
    file_provenance_json: entry.file_provenance
      ? JSON.stringify(entry.file_provenance)
      : null,
    reactions_json: entry.reactions ? JSON.stringify(entry.reactions) : null,
  };
}

/**
 * Derive the display PR state from PR metadata.
 * Draft PRs show as "draft" even though the underlying state is "open".
 */
function derivePrState(prState: string, isDraft: boolean): PrState {
  if (prState === "closed" || prState === "merged") {
    return prState as PrState;
  }
  if (isDraft) {
    return "draft";
  }
  return prState as PrState;
}

/**
 * Apply optional simple fields from row to entry.
 */
function applyOptionalFields(entry: FirewatchEntry, row: EntryWithPRRow): void {
  if (row.subtype !== null) {
    entry.subtype = row.subtype;
  }
  if (row.body !== null) {
    entry.body = row.body;
  }
  if (row.state !== null) {
    entry.state = row.state;
  }
  if (row.updated_at !== null) {
    entry.updated_at = row.updated_at;
  }
  if (row.url !== null) {
    entry.url = row.url;
  }
  if (row.file !== null) {
    entry.file = row.file;
  }
  if (row.line !== null) {
    entry.line = row.line;
  }
  // Deserialize thread_resolved: 0/1 -> boolean, null -> undefined
  if (row.thread_resolved !== null) {
    entry.thread_resolved = row.thread_resolved === 1;
  }
}

/**
 * Apply optional JSON fields from row to entry.
 */
function applyJsonFields(entry: FirewatchEntry, row: EntryWithPRRow): void {
  if (row.graphite_json) {
    try {
      entry.graphite = JSON.parse(row.graphite_json) as GraphiteMetadata;
    } catch {
      // Ignore parse errors
    }
  }
  if (row.file_activity_json) {
    try {
      entry.file_activity_after = JSON.parse(
        row.file_activity_json
      ) as FileActivityAfter;
    } catch {
      // Ignore parse errors
    }
  }
  if (row.file_provenance_json) {
    try {
      entry.file_provenance = JSON.parse(
        row.file_provenance_json
      ) as FileProvenance;
    } catch {
      // Ignore parse errors
    }
  }
  if (row.reactions_json) {
    try {
      entry.reactions = JSON.parse(row.reactions_json) as CommentReactions;
    } catch {
      // Ignore parse errors
    }
  }
}

/**
 * Convert a joined database row (entry + PR) to a FirewatchEntry.
 * This is the critical function that computes pr_state from current PR metadata.
 */
export function rowToEntry(row: EntryWithPRRow): FirewatchEntry {
  const entry: FirewatchEntry = {
    id: row.id,
    repo: row.repo,
    pr: row.pr,
    pr_title: row.pr_title ?? "",
    pr_state: derivePrState(row.pr_state, row.pr_is_draft === 1),
    pr_author: row.pr_author ?? "unknown",
    pr_branch: row.pr_branch ?? "",
    type: row.type,
    author: row.author,
    created_at: row.created_at,
    captured_at: row.captured_at,
  };

  // Optional PR labels
  if (row.pr_labels) {
    try {
      const labels = JSON.parse(row.pr_labels) as string[];
      if (labels.length > 0) {
        entry.pr_labels = labels;
      }
    } catch {
      // Ignore parse errors, leave pr_labels undefined
    }
  }

  applyOptionalFields(entry, row);
  applyJsonFields(entry, row);

  return entry;
}

/**
 * Convert a PR database row to PRMetadata.
 */
function rowToPRMetadata(row: PRRow): PRMetadata {
  let labels: string[] = [];
  if (row.labels) {
    try {
      labels = JSON.parse(row.labels) as string[];
    } catch {
      // Ignore parse errors
    }
  }

  return {
    repo: row.repo,
    number: row.number,
    nodeId: row.node_id ?? undefined,
    state: row.state as "open" | "closed" | "merged",
    isDraft: row.is_draft === 1,
    title: row.title ?? undefined,
    author: row.author ?? undefined,
    branch: row.branch ?? undefined,
    labels,
    updatedAt: row.updated_at ?? undefined,
  };
}

/**
 * Convert PRMetadata to parameters for database insert.
 */
function prMetadataToParams(pr: PRMetadata): Record<string, unknown> {
  return {
    $repo: pr.repo,
    $number: pr.number,
    $node_id: pr.nodeId ?? null,
    $state: pr.state,
    $is_draft: pr.isDraft ? 1 : 0,
    $title: pr.title ?? null,
    $author: pr.author ?? null,
    $branch: pr.branch ?? null,
    $labels: pr.labels.length > 0 ? JSON.stringify(pr.labels) : null,
    $updated_at: pr.updatedAt ?? null,
  };
}

// =============================================================================
// Entry Operations
// =============================================================================

const INSERT_ENTRY_SQL = `
  INSERT OR REPLACE INTO entries
  (id, repo, pr, type, subtype, author, body, state, created_at, updated_at,
   captured_at, url, file, line, thread_resolved, graphite_json, file_activity_json, file_provenance_json,
   reactions_json)
  VALUES ($id, $repo, $pr, $type, $subtype, $author, $body, $state, $created_at,
          $updated_at, $captured_at, $url, $file, $line, $thread_resolved, $graphite_json,
          $file_activity_json, $file_provenance_json, $reactions_json)
`;

/**
 * Insert a single entry into the database.
 * Uses INSERT OR REPLACE to handle re-syncs.
 */
export function insertEntry(db: Database, entry: FirewatchEntry): void {
  const stmt = getStatement(db, "insertEntry", INSERT_ENTRY_SQL);
  const row = entryToRow(entry);

  stmt.run({
    $id: row.id,
    $repo: row.repo,
    $pr: row.pr,
    $type: row.type,
    $subtype: row.subtype,
    $author: row.author,
    $body: row.body,
    $state: row.state,
    $created_at: row.created_at,
    $updated_at: row.updated_at,
    $captured_at: row.captured_at,
    $url: row.url,
    $file: row.file,
    $line: row.line,
    $thread_resolved: row.thread_resolved,
    $graphite_json: row.graphite_json,
    $file_activity_json: row.file_activity_json,
    $file_provenance_json: row.file_provenance_json,
    $reactions_json: row.reactions_json,
  });
}

/**
 * Insert multiple entries in a single transaction.
 * More efficient than individual inserts for bulk operations.
 */
export function insertEntries(db: Database, entries: FirewatchEntry[]): void {
  if (entries.length === 0) {
    return;
  }

  const stmt = getStatement(db, "insertEntry", INSERT_ENTRY_SQL);

  const insertAll = db.transaction(() => {
    for (const entry of entries) {
      const row = entryToRow(entry);
      stmt.run({
        $id: row.id,
        $repo: row.repo,
        $pr: row.pr,
        $type: row.type,
        $subtype: row.subtype,
        $author: row.author,
        $body: row.body,
        $state: row.state,
        $created_at: row.created_at,
        $updated_at: row.updated_at,
        $captured_at: row.captured_at,
        $url: row.url,
        $file: row.file,
        $line: row.line,
        $thread_resolved: row.thread_resolved,
        $graphite_json: row.graphite_json,
        $file_activity_json: row.file_activity_json,
        $file_provenance_json: row.file_provenance_json,
        $reactions_json: row.reactions_json,
      });
    }
  });

  insertAll();
}

/**
 * Build state filter conditions from PrState array.
 * Handles the complexity of draft being a special case (is_draft flag vs state column).
 */
function buildStateConditions(
  states: PrState[],
  params: Record<string, unknown>
): string | null {
  if (states.length === 0) {
    return null;
  }

  const stateConditions: string[] = [];
  const nonDraftStates: string[] = [];

  for (const state of states) {
    if (state === "draft") {
      stateConditions.push("(p.state = 'open' AND p.is_draft = 1)");
    } else if (state === "open") {
      // "open" means state is open AND not draft
      stateConditions.push("(p.state = 'open' AND p.is_draft = 0)");
    } else {
      nonDraftStates.push(state);
    }
  }

  if (nonDraftStates.length > 0) {
    const placeholders = nonDraftStates.map((_, i) => `$state_${i}`).join(", ");
    stateConditions.push(`p.state IN (${placeholders})`);
    for (const [i, state] of nonDraftStates.entries()) {
      params[`$state_${i}`] = state;
    }
  }

  return stateConditions.length > 0
    ? `(${stateConditions.join(" OR ")})`
    : null;
}

function applyIdFilter(
  filters: QueryFilters,
  conditions: string[],
  params: Record<string, unknown>
): void {
  if (!filters.id) {
    return;
  }
  conditions.push("e.id = $id");
  params.$id = filters.id;
}

function applyRepoFilter(
  filters: QueryFilters,
  conditions: string[],
  params: Record<string, unknown>
): void {
  if (filters.exactRepo) {
    conditions.push("e.repo = $exactRepo");
    params.$exactRepo = filters.exactRepo;
    return;
  }
  if (filters.repo) {
    conditions.push("e.repo LIKE $repo");
    params.$repo = `%${filters.repo}%`;
  }
}

function applyPrFilter(
  filters: QueryFilters,
  conditions: string[],
  params: Record<string, unknown>
): void {
  if (Array.isArray(filters.pr) && filters.pr.length > 0) {
    const placeholders = filters.pr.map((_, i) => `$pr_${i}`).join(", ");
    conditions.push(`e.pr IN (${placeholders})`);
    for (const [i, pr] of filters.pr.entries()) {
      params[`$pr_${i}`] = pr;
    }
    return;
  }
  if (filters.pr !== undefined) {
    conditions.push("e.pr = $pr");
    params.$pr = filters.pr;
  }
}

function applyAuthorFilter(
  filters: QueryFilters,
  conditions: string[],
  params: Record<string, unknown>
): void {
  if (!filters.author) {
    return;
  }
  conditions.push("e.author = $author");
  params.$author = filters.author;
}

function applyTypeFilter(
  filters: QueryFilters,
  conditions: string[],
  params: Record<string, unknown>
): void {
  if (!filters.type) {
    return;
  }
  const types = Array.isArray(filters.type) ? filters.type : [filters.type];
  const placeholders = types.map((_, i) => `$type_${i}`).join(", ");
  conditions.push(`e.type IN (${placeholders})`);
  for (const [i, type] of types.entries()) {
    params[`$type_${i}`] = type;
  }
}

function applyStateFilter(
  filters: QueryFilters,
  conditions: string[],
  params: Record<string, unknown>
): void {
  if (!filters.states?.length) {
    return;
  }
  const stateCondition = buildStateConditions(filters.states, params);
  if (stateCondition) {
    conditions.push(stateCondition);
  }
}

function applyLabelFilter(
  filters: QueryFilters,
  conditions: string[],
  params: Record<string, unknown>
): void {
  if (!filters.label) {
    return;
  }
  conditions.push(`
      EXISTS (
        SELECT 1 FROM json_each(p.labels) AS label
        WHERE LOWER(label.value) LIKE $label
      )
    `);
  params.$label = `%${filters.label.toLowerCase()}%`;
}

function applySinceFilter(
  filters: QueryFilters,
  conditions: string[],
  params: Record<string, unknown>
): void {
  if (!filters.since) {
    return;
  }
  conditions.push("e.created_at >= $since");
  params.$since = filters.since.toISOString();
}

function applyOrphanedFilter(
  filters: QueryFilters,
  conditions: string[]
): void {
  if (!filters.orphaned) {
    return;
  }
  conditions.push("e.thread_resolved = 0");
  conditions.push("e.subtype = 'review_comment'");
  conditions.push("p.state IN ('merged', 'closed')");
}

function applyExcludeStaleFilter(
  filters: QueryFilters,
  conditions: string[]
): void {
  if (!filters.excludeStale || filters.orphaned) {
    return;
  }
  // Use COALESCE to treat NULL thread_resolved as resolved (1), so only
  // explicitly unresolved (0) comments on closed PRs are filtered out.
  // This preserves older data that may not have resolution state synced.
  conditions.push(
    "NOT (e.subtype = 'review_comment' AND COALESCE(e.thread_resolved, 1) = 0 AND p.state IN ('merged', 'closed'))"
  );
}

function applyFreezeFilter(
  filters: QueryFilters,
  conditions: string[]
): void {
  if (filters.includeFrozen) {
    return;
  }
  conditions.push("(p.frozen_at IS NULL OR e.created_at <= p.frozen_at)");
}

/**
 * Build a dynamic WHERE clause from QueryFilters.
 * Returns the SQL fragment and parameter object.
 */
function buildWhereClause(filters: QueryFilters): {
  sql: string;
  params: Record<string, unknown>;
} {
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  applyIdFilter(filters, conditions, params);
  applyRepoFilter(filters, conditions, params);
  applyPrFilter(filters, conditions, params);
  applyAuthorFilter(filters, conditions, params);
  applyTypeFilter(filters, conditions, params);
  applyStateFilter(filters, conditions, params);
  applyLabelFilter(filters, conditions, params);
  applySinceFilter(filters, conditions, params);
  applyOrphanedFilter(filters, conditions);
  applyExcludeStaleFilter(filters, conditions);
  applyFreezeFilter(filters, conditions);

  return {
    sql: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

/**
 * Query entries with filters, joining with PR table for current state.
 * This is the primary query function that returns entries with up-to-date PR state.
 * Note: custom plugin filters are applied in the higher-level query module.
 */
export function queryEntries(
  db: Database,
  filters: QueryFilters = {}
): FirewatchEntry[] {
  const { sql: whereClause, params } = buildWhereClause(filters);

  const query = `
    SELECT
      e.id, e.repo, e.pr, e.type, e.subtype, e.author, e.body, e.state,
      e.created_at, e.updated_at, e.captured_at, e.url, e.file, e.line,
      e.thread_resolved, e.graphite_json, e.file_activity_json, e.file_provenance_json,
      e.reactions_json,
      p.state AS pr_state, p.is_draft AS pr_is_draft,
      p.title AS pr_title, p.author AS pr_author,
      p.branch AS pr_branch, p.labels AS pr_labels
    FROM entries e
    JOIN prs p ON e.repo = p.repo AND e.pr = p.number
    ${whereClause}
    ORDER BY e.created_at DESC
  `;

  const stmt = db.prepare(query);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dynamic SQL params
  const rows = stmt.all(params as any) as EntryWithPRRow[];
  let entries = rows.map(rowToEntry);

  if (filters.excludeAuthors?.length || filters.excludeBots) {
    entries = entries.filter((entry) => {
      if (
        filters.excludeAuthors?.length &&
        isExcludedAuthor(entry.author, filters.excludeAuthors)
      ) {
        return false;
      }

      if (filters.excludeBots) {
        const patterns = filters.botPatterns ?? DEFAULT_BOT_PATTERNS;
        if (isBot(entry.author, patterns)) {
          return false;
        }
      }

      return true;
    });
  }

  return entries;
}

/**
 * Update specific fields of an entry.
 * Useful for file activity updates.
 */
export function updateEntry(
  db: Database,
  id: string,
  repo: string,
  updates: EntryUpdates
): void {
  const setClauses: string[] = [];
  const params: Record<string, unknown> = { $id: id, $repo: repo };

  if (updates.body !== undefined) {
    setClauses.push("body = $body");
    params.$body = updates.body;
  }

  if (updates.state !== undefined) {
    setClauses.push("state = $state");
    params.$state = updates.state;
  }

  if (updates.updated_at !== undefined) {
    setClauses.push("updated_at = $updated_at");
    params.$updated_at = updates.updated_at;
  }

  if (updates.file_activity_after !== undefined) {
    setClauses.push("file_activity_json = $file_activity_json");
    params.$file_activity_json = JSON.stringify(updates.file_activity_after);
  }

  if (setClauses.length === 0) {
    return;
  }

  const sql = `UPDATE entries SET ${setClauses.join(", ")} WHERE id = $id AND repo = $repo`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dynamic SQL params
  db.prepare(sql).run(params as any);
}

/**
 * Delete all entries for a repository.
 * Useful for full sync scenarios.
 */
export function deleteEntriesByRepo(db: Database, repo: string): void {
  const stmt = getStatement(
    db,
    "deleteEntriesByRepo",
    "DELETE FROM entries WHERE repo = $repo"
  );
  stmt.run({ $repo: repo });
}

/**
 * Get an entry by ID and repo.
 */
export function getEntry(
  db: Database,
  id: string,
  repo: string
): FirewatchEntry | null {
  const query = `
    SELECT
      e.id, e.repo, e.pr, e.type, e.subtype, e.author, e.body, e.state,
      e.created_at, e.updated_at, e.captured_at, e.url, e.file, e.line,
      e.thread_resolved, e.graphite_json, e.file_activity_json, e.file_provenance_json,
      e.reactions_json,
      p.state AS pr_state, p.is_draft AS pr_is_draft,
      p.title AS pr_title, p.author AS pr_author,
      p.branch AS pr_branch, p.labels AS pr_labels
    FROM entries e
    JOIN prs p ON e.repo = p.repo AND e.pr = p.number
    WHERE e.id = $id AND e.repo = $repo
  `;

  const stmt = db.prepare(query);
  const row = stmt.get({ $id: id, $repo: repo }) as EntryWithPRRow | null;

  return row ? rowToEntry(row) : null;
}

// =============================================================================
// PR Metadata Operations
// =============================================================================

const UPSERT_PR_SQL = `
  INSERT INTO prs (repo, number, node_id, state, is_draft, title, author, branch, labels, updated_at)
  VALUES ($repo, $number, $node_id, $state, $is_draft, $title, $author, $branch, $labels, $updated_at)
  ON CONFLICT(repo, number) DO UPDATE SET
    node_id = excluded.node_id,
    state = excluded.state,
    is_draft = excluded.is_draft,
    title = excluded.title,
    author = excluded.author,
    branch = excluded.branch,
    labels = excluded.labels,
    updated_at = excluded.updated_at
`;

/**
 * Insert or update a PR's metadata.
 * This is the key function that keeps PR state fresh.
 */
export function upsertPR(db: Database, pr: PRMetadata): void {
  const stmt = getStatement(db, "upsertPR", UPSERT_PR_SQL);
  stmt.run(prMetadataToParams(pr));
}

/**
 * Insert or update multiple PRs in a single transaction.
 */
export function upsertPRs(db: Database, prs: PRMetadata[]): void {
  if (prs.length === 0) {
    return;
  }

  const stmt = getStatement(db, "upsertPR", UPSERT_PR_SQL);

  const upsertAll = db.transaction(() => {
    for (const pr of prs) {
      stmt.run(prMetadataToParams(pr));
    }
  });

  upsertAll();
}

/**
 * Get PR metadata by repo and number.
 */
export function getPR(
  db: Database,
  repo: string,
  number: number
): PRMetadata | null {
  const stmt = getStatement(
    db,
    "getPR",
    "SELECT * FROM prs WHERE repo = $repo AND number = $number"
  );
  const row = stmt.get({ $repo: repo, $number: number }) as PRRow | null;

  return row ? rowToPRMetadata(row) : null;
}

/**
 * Get all PRs for a repository matching given states.
 */
export function getPRsByState(
  db: Database,
  repo: string,
  states: PrState[]
): PRMetadata[] {
  if (states.length === 0) {
    return [];
  }

  // Build dynamic state conditions
  const conditions: string[] = ["repo = $repo"];
  const params: Record<string, unknown> = { $repo: repo };

  const stateConditions: string[] = [];
  const nonDraftStates: string[] = [];

  for (const state of states) {
    if (state === "draft") {
      stateConditions.push("(state = 'open' AND is_draft = 1)");
    } else if (state === "open") {
      stateConditions.push("(state = 'open' AND is_draft = 0)");
    } else {
      nonDraftStates.push(state);
    }
  }

  if (nonDraftStates.length > 0) {
    const placeholders = nonDraftStates.map((_, i) => `$state_${i}`).join(", ");
    stateConditions.push(`state IN (${placeholders})`);
    for (const [i, state] of nonDraftStates.entries()) {
      params[`$state_${i}`] = state;
    }
  }

  if (stateConditions.length > 0) {
    conditions.push(`(${stateConditions.join(" OR ")})`);
  }

  const sql = `SELECT * FROM prs WHERE ${conditions.join(" AND ")}`;
  const stmt = db.prepare(sql);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dynamic SQL params
  const rows = stmt.all(params as any) as PRRow[];

  return rows.map(rowToPRMetadata);
}

/**
 * Update the state of a PR.
 */
export function updatePRState(
  db: Database,
  repo: string,
  number: number,
  state: PrState
): void {
  const isDraft = state === "draft";
  const dbState = isDraft ? "open" : state;

  const stmt = getStatement(
    db,
    "updatePRState",
    "UPDATE prs SET state = $state, is_draft = $is_draft WHERE repo = $repo AND number = $number"
  );

  stmt.run({
    $repo: repo,
    $number: number,
    $state: dbState,
    $is_draft: isDraft ? 1 : 0,
  });
}

/**
 * Delete a PR and all its entries (cascade).
 */
export function deletePR(db: Database, repo: string, number: number): void {
  // Delete entries first (foreign key constraint)
  db.prepare("DELETE FROM entries WHERE repo = $repo AND pr = $pr").run({
    $repo: repo,
    $pr: number,
  });

  // Then delete PR
  db.prepare("DELETE FROM prs WHERE repo = $repo AND number = $number").run({
    $repo: repo,
    $number: number,
  });
}

function getScopeMeta(row: SyncMetaRow, scope: SyncScope): SyncMetadata | null {
  const columns = SYNC_SCOPE_COLUMNS[scope];
  const lastSync = row[columns.lastSync];
  if (!lastSync) {
    return null;
  }

  return {
    repo: row.repo,
    scope,
    cursor: row[columns.cursor] ?? undefined,
    last_sync: lastSync,
    pr_count: row[columns.prCount],
  };
}

// =============================================================================
// Sync Metadata Operations
// =============================================================================

/**
 * Get sync metadata for a repository.
 */
export function getSyncMeta(
  db: Database,
  repo: string,
  scope: SyncScope
): SyncMetadata | null {
  const stmt = getStatement(
    db,
    "getSyncMeta",
    "SELECT * FROM sync_meta WHERE repo = $repo"
  );
  const row = stmt.get({ $repo: repo }) as SyncMetaRow | null;

  if (!row) {
    return null;
  }

  return getScopeMeta(row, scope);
}

/**
 * Set sync metadata for a repository (upsert).
 */
export function setSyncMeta(db: Database, meta: SyncMetadata): void {
  // Legacy columns track the most recent sync across scopes for compatibility.
  const columns = SYNC_SCOPE_COLUMNS[meta.scope];
  const stmt = getStatement(
    db,
    `setSyncMeta_${meta.scope}`,
    `
    INSERT INTO sync_meta (
      repo,
      cursor,
      last_sync,
      pr_count,
      ${columns.cursor},
      ${columns.lastSync},
      ${columns.prCount}
    )
    VALUES (
      $repo,
      $cursor,
      $last_sync,
      $pr_count,
      $scope_cursor,
      $scope_last_sync,
      $scope_pr_count
    )
    ON CONFLICT(repo) DO UPDATE SET
      cursor = CASE
        WHEN excluded.last_sync >= last_sync THEN excluded.cursor
        ELSE cursor
      END,
      last_sync = CASE
        WHEN excluded.last_sync >= last_sync THEN excluded.last_sync
        ELSE last_sync
      END,
      pr_count = CASE
        WHEN excluded.last_sync >= last_sync THEN excluded.pr_count
        ELSE pr_count
      END,
      ${columns.cursor} = excluded.${columns.cursor},
      ${columns.lastSync} = excluded.${columns.lastSync},
      ${columns.prCount} = excluded.${columns.prCount}
  `
  );

  stmt.run({
    $repo: meta.repo,
    $cursor: meta.cursor ?? null,
    $last_sync: meta.last_sync,
    $pr_count: meta.pr_count,
    $scope_cursor: meta.cursor ?? null,
    $scope_last_sync: meta.last_sync,
    $scope_pr_count: meta.pr_count,
  });
}

/**
 * Delete sync metadata for a repository.
 */
export function deleteSyncMeta(db: Database, repo: string): void {
  const stmt = getStatement(
    db,
    "deleteSyncMeta",
    "DELETE FROM sync_meta WHERE repo = $repo"
  );
  stmt.run({ $repo: repo });
}

/**
 * Get all sync metadata (all repos).
 */
export function getAllSyncMeta(db: Database): SyncMetadata[] {
  const stmt = db.prepare("SELECT * FROM sync_meta");
  const rows = stmt.all() as SyncMetaRow[];

  const meta: SyncMetadata[] = [];
  for (const row of rows) {
    const openMeta = getScopeMeta(row, "open");
    if (openMeta) {
      meta.push(openMeta);
    }
    const closedMeta = getScopeMeta(row, "closed");
    if (closedMeta) {
      meta.push(closedMeta);
    }
  }
  return meta;
}

// =============================================================================
// Utility Operations
// =============================================================================

/**
 * Count entries matching filters.
 */
export function countEntries(db: Database, filters: QueryFilters = {}): number {
  const { sql: whereClause, params } = buildWhereClause(filters);

  const query = `
    SELECT COUNT(*) AS count
    FROM entries e
    JOIN prs p ON e.repo = p.repo AND e.pr = p.number
    ${whereClause}
  `;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dynamic SQL params
  const result = db.prepare(query).get(params as any) as {
    count: number;
  } | null;
  return result?.count ?? 0;
}

/**
 * Get distinct repos from the entries table.
 */
export function getRepos(db: Database): string[] {
  const stmt = db.prepare("SELECT DISTINCT repo FROM entries ORDER BY repo");
  const rows = stmt.all() as { repo: string }[];
  return rows.map((row) => row.repo);
}

/**
 * Clear all data for a repository (entries, PR, sync meta).
 * Useful for full sync.
 */
export function clearRepo(db: Database, repo: string): void {
  const clearAll = db.transaction(() => {
    db.prepare("DELETE FROM entries WHERE repo = $repo").run({ $repo: repo });
    db.prepare("DELETE FROM prs WHERE repo = $repo").run({ $repo: repo });
    db.prepare("DELETE FROM sync_meta WHERE repo = $repo").run({ $repo: repo });
  });

  clearAll();
}
