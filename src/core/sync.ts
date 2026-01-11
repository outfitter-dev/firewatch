import type { FirewatchPlugin } from "../plugins/types";
import type { FirewatchEntry, SyncMetadata } from "../schema/entry";
import {
  PATHS,
  appendJsonl,
  getRepoCachePath,
  readJsonl,
  writeJsonl,
} from "./cache";
import type { GitHubClient, PRNode } from "./github";

/**
 * Map GitHub PR state to Firewatch state.
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
 * Convert a PR node to Firewatch entries.
 */
function prToEntries(
  repo: string,
  pr: PRNode,
  capturedAt: string
): FirewatchEntry[] {
  const entries: FirewatchEntry[] = [];
  const prContext = {
    repo,
    pr: pr.number,
    pr_title: pr.title,
    pr_state: mapPRState(pr.state, pr.isDraft),
    pr_author: pr.author?.login ?? "unknown",
    pr_branch: pr.headRefName,
  };

  // Reviews
  for (const review of pr.reviews.nodes) {
    entries.push({
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
    });
  }

  // Issue comments
  for (const comment of pr.comments.nodes) {
    entries.push({
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
    });
  }

  // Review thread comments (code comments)
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
      });
    }
  }

  // Commits
  for (const { commit } of pr.commits.nodes) {
    entries.push({
      ...prContext,
      id: commit.oid,
      type: "commit",
      author: commit.author?.name ?? commit.author?.email ?? "unknown",
      body: commit.message,
      created_at: commit.committedDate,
      captured_at: capturedAt,
    });
  }

  return entries;
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
 * Sync a repository's PR activity.
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

  const cachePath = getRepoCachePath(repo);
  const capturedAt = new Date().toISOString();

  // Load existing sync metadata
  const allMeta = await readJsonl<SyncMetadata>(PATHS.meta);
  const repoMeta = allMeta.find((m) => m.repo === repo);
  const cursor = options.full ? null : (repoMeta?.cursor ?? null);

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

    for (const pr of nodes) {
      // Skip if updated before 'since' date
      if (options.since && new Date(pr.updatedAt) < options.since) {
        hasNextPage = false;
        break;
      }

      let entries = prToEntries(repo, pr, capturedAt);

      // Run plugins
      if (options.plugins) {
        for (const plugin of options.plugins) {
          if (plugin.enrich) {
            entries = await Promise.all(entries.map((e) => plugin.enrich!(e)));
          }
        }
      }

      // Append to cache
      for (const entry of entries) {
        await appendJsonl(cachePath, entry);
        entriesAdded++;
      }

      prsProcessed++;
    }

    hasNextPage = pageInfo.hasNextPage && hasNextPage;
    currentCursor = pageInfo.endCursor;
  }

  // Update sync metadata
  const newMeta: SyncMetadata = {
    repo,
    last_sync: capturedAt,
    cursor: currentCursor ?? undefined,
    pr_count: prsProcessed,
  };

  const updatedMeta = allMeta.filter((m) => m.repo !== repo);
  updatedMeta.push(newMeta);
  await writeJsonl(PATHS.meta, updatedMeta);

  return {
    repo,
    entriesAdded,
    prsProcessed,
    cursor: currentCursor,
  };
}
