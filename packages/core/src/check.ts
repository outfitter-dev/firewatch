import type { Database } from "bun:sqlite";

import { getDatabase } from "./cache";
import { queryEntries, updateEntry } from "./repository";
import type { FileActivityAfter, FirewatchEntry } from "./schema/entry";

interface CommitActivity {
  id: string;
  created_at: string;
  timestamp: number;
  files?: string[];
}

export interface CheckResult {
  repo: string;
  comments_checked: number;
  entries_updated: number;
}

export interface CheckOptions {
  /**
   * Resolve the list of files changed in a commit.
   * Called for each commit entry to enrich staleness detection.
   * Return null if file info unavailable (e.g., API error).
   */
  resolveCommitFiles?: (commitId: string) => Promise<string[] | null>;
}

async function buildCommitIndex(
  entries: FirewatchEntry[],
  options: CheckOptions
): Promise<Map<number, CommitActivity[]>> {
  const index = new Map<number, CommitActivity[]>();
  const commitFiles = new Map<string, string[]>();

  for (const entry of entries) {
    if (entry.type !== "commit") {
      continue;
    }

    // Resolve files for this commit if resolver provided and not already cached
    if (options.resolveCommitFiles && !commitFiles.has(entry.id)) {
      const files = await options.resolveCommitFiles(entry.id);
      if (files && files.length > 0) {
        commitFiles.set(entry.id, files);
      }
    }

    const list = index.get(entry.pr) ?? [];
    const activity: CommitActivity = {
      id: entry.id,
      created_at: entry.created_at,
      timestamp: new Date(entry.created_at).getTime(),
    };
    const files = commitFiles.get(entry.id);
    if (files) {
      activity.files = files;
    }
    list.push(activity);
    index.set(entry.pr, list);
  }

  for (const list of index.values()) {
    list.sort((a, b) => a.timestamp - b.timestamp);
  }

  return index;
}

function computeActivityAfter(
  entry: FirewatchEntry,
  commits: CommitActivity[]
): FileActivityAfter {
  const commentTime = new Date(entry.created_at).getTime();
  const hasFile = Boolean(entry.file);

  // If entry has a file path, check if we have complete file data for all commits
  const commitsWithFiles = commits.filter(
    (commit) => commit.files && commit.files.length > 0
  );
  const hasCompleteFileData =
    commits.length > 0 && commitsWithFiles.length === commits.length;

  // Only do file-specific filtering if we have complete file data
  const canFilterByFile = hasFile && hasCompleteFileData;

  let count = 0;
  let latest: CommitActivity | undefined;

  for (const commit of commits) {
    if (commit.timestamp <= commentTime) {
      continue;
    }
    // Skip commits that don't touch the file (only if we have complete file data)
    if (
      canFilterByFile &&
      commit.files &&
      entry.file &&
      !commit.files.includes(entry.file)
    ) {
      continue;
    }
    count += 1;
    latest = commit;
  }

  if (!latest) {
    return {
      modified: false,
      commits_touching_file: 0,
    };
  }

  return {
    modified: true,
    commits_touching_file: count,
    latest_commit: latest.id,
    latest_commit_at: latest.created_at,
  };
}

function activityEqual(
  next: FileActivityAfter,
  current: FileActivityAfter | undefined
): boolean {
  if (!current) {
    return false;
  }

  return (
    next.modified === current.modified &&
    next.commits_touching_file === current.commits_touching_file &&
    next.latest_commit === current.latest_commit &&
    next.latest_commit_at === current.latest_commit_at
  );
}

/**
 * Check file activity for entries using SQLite database.
 * Updates entries in-place with efficient UPDATE statements.
 *
 * @param db - Database instance
 * @param repo - Repository in owner/repo format
 * @param options - Check options including file resolver
 * @returns Check result with counts
 */
export async function checkRepoDb(
  db: Database,
  repo: string,
  options: CheckOptions = {}
): Promise<CheckResult> {
  // Query all entries for the repo from SQLite (exact match)
  const entries = queryEntries(db, { exactRepo: repo });
  if (entries.length === 0) {
    return { repo, comments_checked: 0, entries_updated: 0 };
  }

  const commitIndex = await buildCommitIndex(entries, options);
  let commentsChecked = 0;
  let entriesUpdated = 0;

  // Track updates for batch processing
  const updates: { id: string; repo: string; activity: FileActivityAfter }[] =
    [];

  for (const entry of entries) {
    if (entry.type !== "comment") {
      continue;
    }

    commentsChecked += 1;
    const commits = commitIndex.get(entry.pr) ?? [];
    const activity = computeActivityAfter(entry, commits);

    if (activityEqual(activity, entry.file_activity_after)) {
      continue;
    }

    entriesUpdated += 1;
    updates.push({ id: entry.id, repo: entry.repo, activity });
  }

  // Apply updates to SQLite
  for (const { id, repo: entryRepo, activity } of updates) {
    updateEntry(db, id, entryRepo, { file_activity_after: activity });
  }

  return {
    repo,
    comments_checked: commentsChecked,
    entries_updated: entriesUpdated,
  };
}

/**
 * Check file activity for entries.
 *
 * Uses SQLite database to query and update entries with file activity hints.
 *
 * @param repo - Repository in owner/repo format
 * @param options - Check options including file resolver
 * @returns Check result with counts
 */
export function checkRepo(
  repo: string,
  options: CheckOptions = {}
): Promise<CheckResult> {
  const db = getDatabase();
  return checkRepoDb(db, repo, options);
}
