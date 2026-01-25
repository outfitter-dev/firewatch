/**
 * PR Freeze functionality for Firewatch.
 *
 * Freezing a PR sets a timestamp cutoff. Entries created after the freeze
 * timestamp are hidden from query results (unless includeFrozen is set).
 * Frozen PRs continue syncing normally - freeze only affects display.
 */
import type { Database } from "bun:sqlite";

/**
 * Information about a PR's freeze state.
 */
export interface FreezeInfo {
  repo: string;
  pr: number;
  frozen_at: string | null; // ISO timestamp or null if not frozen
}

/**
 * Database row type for freeze queries.
 */
interface FreezeRow {
  repo: string;
  number: number;
  frozen_at: string | null;
}

/**
 * Freeze a PR at the current timestamp.
 * Entries created after this time will be hidden from queries.
 *
 * @param db - Database instance
 * @param repo - Repository slug (owner/repo)
 * @param pr - PR number
 * @returns The freeze info with the new frozen_at timestamp
 */
export function freezePR(db: Database, repo: string, pr: number): FreezeInfo {
  const frozenAt = new Date().toISOString();

  const stmt = db.prepare(`
    UPDATE prs
    SET frozen_at = $frozen_at
    WHERE repo = $repo AND number = $number
  `);

  const result = stmt.run({
    $repo: repo,
    $number: pr,
    $frozen_at: frozenAt,
  });

  if (result.changes === 0) {
    throw new Error(`PR #${pr} not found in ${repo}`);
  }

  return {
    repo,
    pr,
    frozen_at: frozenAt,
  };
}

/**
 * Unfreeze a PR, removing the timestamp cutoff.
 * All entries will be visible again in queries.
 *
 * @param db - Database instance
 * @param repo - Repository slug (owner/repo)
 * @param pr - PR number
 * @returns The freeze info (frozen_at will be null after unfreezing)
 */
export function unfreezePR(db: Database, repo: string, pr: number): FreezeInfo {
  // Get the previous frozen_at value for reporting
  const previousStmt = db.prepare(`
    SELECT frozen_at FROM prs WHERE repo = $repo AND number = $number
  `);
  const previous = previousStmt.get({ $repo: repo, $number: pr }) as {
    frozen_at: string | null;
  } | null;

  if (!previous) {
    throw new Error(`PR #${pr} not found in ${repo}`);
  }

  const stmt = db.prepare(`
    UPDATE prs
    SET frozen_at = NULL
    WHERE repo = $repo AND number = $number
  `);

  stmt.run({
    $repo: repo,
    $number: pr,
  });

  return {
    repo,
    pr,
    frozen_at: null,
  };
}

/**
 * Check if a PR is currently frozen.
 *
 * @param db - Database instance
 * @param repo - Repository slug (owner/repo)
 * @param pr - PR number
 * @returns True if the PR has a frozen_at timestamp
 */
export function isFrozen(db: Database, repo: string, pr: number): boolean {
  const stmt = db.prepare(`
    SELECT frozen_at FROM prs WHERE repo = $repo AND number = $number
  `);

  const row = stmt.get({ $repo: repo, $number: pr }) as {
    frozen_at: string | null;
  } | null;

  return row?.frozen_at != null;
}

/**
 * Get freeze info for a specific PR.
 *
 * @param db - Database instance
 * @param repo - Repository slug (owner/repo)
 * @param pr - PR number
 * @returns Freeze info or null if PR not found
 */
export function getFreezeInfo(
  db: Database,
  repo: string,
  pr: number
): FreezeInfo | null {
  const stmt = db.prepare(`
    SELECT repo, number, frozen_at FROM prs WHERE repo = $repo AND number = $number
  `);

  const row = stmt.get({ $repo: repo, $number: pr }) as FreezeRow | null;

  if (!row) {
    return null;
  }

  return {
    repo: row.repo,
    pr: row.number,
    frozen_at: row.frozen_at,
  };
}

/**
 * Get all frozen PRs, optionally filtered by repository.
 *
 * @param db - Database instance
 * @param repo - Optional repository slug to filter by
 * @returns Array of freeze info for all frozen PRs
 */
export function getFrozenPRs(db: Database, repo?: string): FreezeInfo[] {
  let query = "SELECT repo, number, frozen_at FROM prs WHERE frozen_at IS NOT NULL";
  const params: Record<string, unknown> = {};

  if (repo) {
    query += " AND repo = $repo";
    params.$repo = repo;
  }

  query += " ORDER BY frozen_at DESC";

  const stmt = db.prepare(query);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dynamic params
  const rows = stmt.all(params as any) as FreezeRow[];

  return rows.map((row) => ({
    repo: row.repo,
    pr: row.number,
    frozen_at: row.frozen_at,
  }));
}

/**
 * Count entries that would be hidden by the freeze for a given PR.
 * Useful for reporting when unfreezing.
 *
 * @param db - Database instance
 * @param repo - Repository slug (owner/repo)
 * @param pr - PR number
 * @returns Number of entries after the freeze timestamp
 */
export function countHiddenEntries(
  db: Database,
  repo: string,
  pr: number
): number {
  const stmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM entries e
    JOIN prs p ON e.repo = p.repo AND e.pr = p.number
    WHERE e.repo = $repo AND e.pr = $pr
      AND p.frozen_at IS NOT NULL
      AND e.created_at > p.frozen_at
  `);

  const result = stmt.get({ $repo: repo, $pr: pr }) as { count: number } | null;
  return result?.count ?? 0;
}
