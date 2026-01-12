import { getRepoCachePath, readJsonl, writeJsonl } from "./cache";
import type { FirewatchEntry, FileActivityAfter } from "./schema/entry";

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

function buildCommitIndex(
  entries: FirewatchEntry[]
): Map<number, CommitActivity[]> {
  const index = new Map<number, CommitActivity[]>();

  for (const entry of entries) {
    if (entry.type !== "commit") {
      continue;
    }

    const list = index.get(entry.pr) ?? [];
    list.push({
      id: entry.id,
      created_at: entry.created_at,
      timestamp: new Date(entry.created_at).getTime(),
    });
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

  let count = 0;
  let latest: CommitActivity | undefined;

  for (const commit of commits) {
    if (commit.timestamp <= commentTime) {
      continue;
    }
    if (
      hasFile &&
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

export async function checkRepo(repo: string): Promise<CheckResult> {
  const cachePath = getRepoCachePath(repo);
  const entries = await readJsonl<FirewatchEntry>(cachePath);
  if (entries.length === 0) {
    return { repo, comments_checked: 0, entries_updated: 0 };
  }

  const commitIndex = buildCommitIndex(entries);
  let commentsChecked = 0;
  let entriesUpdated = 0;

  const updatedEntries = entries.map((entry) => {
    if (entry.type !== "comment") {
      return entry;
    }

    commentsChecked += 1;
    const commits = commitIndex.get(entry.pr) ?? [];
    const activity = computeActivityAfter(entry, commits);

    if (activityEqual(activity, entry.file_activity_after)) {
      return entry;
    }

    entriesUpdated += 1;
    return {
      ...entry,
      file_activity_after: activity,
    };
  });

  if (entriesUpdated > 0) {
    await writeJsonl(cachePath, updatedEntries);
  }

  return { repo, comments_checked: commentsChecked, entries_updated: entriesUpdated };
}
