/**
 * Handler for syncing GitHub PR activity into the local cache.
 *
 * Orchestrates repo resolution, authentication, optional cache clearing, and
 * calls syncRepo() for each repo. Returns aggregate results with per-repo
 * status so the caller (CLI or MCP) can format progress/output as needed.
 *
 * Progress reporting is done via an optional callback — the handler itself
 * does not write to stdout/stderr.
 */

import { AuthError, Result, ValidationError } from "@outfitter/contracts";

import { detectAuth } from "../auth";
import { clearRepo } from "../repository";
import { detectRepo } from "../repo-detect";
import { getGraphiteStacks, graphitePlugin } from "../plugins";
import { syncRepo } from "../sync";
import type { HandlerContext } from "./types";

// =============================================================================
// Types
// =============================================================================

/** Progress callback for reporting per-repo sync status. */
export type SyncProgressCallback = (
  repo: string,
  status: "start" | "done" | "error",
  detail?: string
) => void;

/** Input parameters for the sync handler. */
export interface SyncInput {
  /**
   * Explicit repos to sync (owner/repo format).
   * If not provided, uses config.repos + auto-detection.
   */
  repos?: string[] | undefined;
  /** Clear cached entries for each repo before syncing. */
  clear?: boolean | undefined;
  /** Force full sync (ignore incremental cursors). */
  full?: boolean | undefined;
  /** Maximum number of PRs to fetch per repo (defaults to config value). */
  maxPrs?: number | undefined;
  /** Progress callback for reporting sync status per repo. */
  onProgress?: SyncProgressCallback | undefined;
}

/** Per-repo sync result. */
export interface SyncRepoResult {
  /** Repository slug (owner/repo). */
  repo: string;
  /** Whether the sync succeeded. */
  ok: boolean;
  /** Number of entries added (populated on success). */
  entries?: number | undefined;
  /** Error message (populated on failure). */
  error?: string | undefined;
}

/** Aggregate output from the sync handler. */
export interface SyncOutput {
  /** Per-repo results. */
  repos: SyncRepoResult[];
  /** Total entries added across all repos. */
  totalEntries: number;
  /** Total wall-clock duration in milliseconds. */
  duration: number;
}

// =============================================================================
// Validation
// =============================================================================

const REPO_FORMAT_REGEX = /^[^/]+\/[^/]+$/;

function isValidRepoFormat(repo: string): boolean {
  return REPO_FORMAT_REGEX.test(repo);
}

// =============================================================================
// Repo Resolution
// =============================================================================

/**
 * Resolve the list of repos to sync from input, config, or auto-detection.
 *
 * Priority order:
 * 1. Explicit `input.repos` (if non-empty)
 * 2. `config.repos` (if configured)
 * 3. Auto-detected repo from git/package.json/Cargo.toml
 */
async function resolveRepos(
  input: SyncInput,
  ctx: HandlerContext
): Promise<string[]> {
  if (input.repos && input.repos.length > 0) {
    return input.repos;
  }

  if (ctx.config.repos.length > 0) {
    return ctx.config.repos;
  }

  const detected = await detectRepo();
  if (detected.repo) {
    return [detected.repo];
  }

  return [];
}

// =============================================================================
// Handler
// =============================================================================

/**
 * Sync GitHub PR activity into the local SQLite cache.
 *
 * Resolves repos, authenticates, optionally clears cache, and calls syncRepo()
 * for each repo. The `onProgress` callback is fired before and after each repo
 * sync so callers can render spinners or log progress.
 *
 * @param input - Repos, clear flag, full flag, and optional progress callback
 * @param ctx - Handler context with config, db, logger
 * @returns Result with aggregate sync output on success, or an error
 */
export async function syncHandler(
  input: SyncInput,
  ctx: HandlerContext
): Promise<Result<SyncOutput, Error>> {
  const startTime = Date.now();

  // Resolve repos
  const repos = await resolveRepos(input, ctx);

  if (repos.length === 0) {
    return Result.err(
      new ValidationError({
        message:
          "No repo to sync. Pass repos, configure repos in .firewatch.toml, or run from a GitHub repository.",
      })
    );
  }

  // Validate all repo formats upfront before touching anything
  for (const repo of repos) {
    if (!isValidRepoFormat(repo)) {
      return Result.err(
        new ValidationError({
          message: `Invalid repo format: '${repo}'. Expected owner/repo`,
        })
      );
    }
  }

  // Handle cache clearing (before auth — no auth needed to clear local cache)
  if (input.clear) {
    for (const repo of repos) {
      clearRepo(ctx.db, repo);
      ctx.logger.debug("Cleared cache for repo", { repo });
    }
  }

  // Authenticate
  const authResult = await detectAuth(ctx.config.github_token);
  if (authResult.isErr()) {
    return Result.err(
      new AuthError({ message: authResult.error.message })
    );
  }

  const { GitHubClient } = await import("../github");
  const client = new GitHubClient(authResult.value.token);

  // Resolve Graphite plugin (best-effort — failure means no plugin)
  const graphiteStacks = await getGraphiteStacks();
  const graphiteAvailable = graphiteStacks !== null;

  // Sync each repo
  const repoResults: SyncRepoResult[] = [];
  let totalEntries = 0;

  for (const repo of repos) {
    input.onProgress?.(repo, "start");

    try {
      // Graphite enrichment only applies to the detected local repo
      const useGraphite = graphiteAvailable;
      const plugins = useGraphite ? [graphitePlugin] : [];

      const syncResult = await syncRepo(client, repo, {
        ...(input.full && { full: true }),
        plugins,
      });

      totalEntries += syncResult.entriesAdded;

      const repoResult: SyncRepoResult = {
        repo,
        ok: true,
        entries: syncResult.entriesAdded,
      };
      repoResults.push(repoResult);

      input.onProgress?.(repo, "done", `${syncResult.entriesAdded} entries`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.logger.error("Sync failed for repo", { repo, error: message });

      repoResults.push({ repo, ok: false, error: message });

      input.onProgress?.(repo, "error", message);
    }
  }

  // If every repo failed, return an error rather than a partial success
  const allFailed =
    repoResults.length > 0 && repoResults.every((r) => !r.ok);
  if (allFailed) {
    const firstError = repoResults[0]?.error ?? "Sync failed";
    return Result.err(new Error(firstError));
  }

  return Result.ok({
    repos: repoResults,
    totalEntries,
    duration: Date.now() - startTime,
  });
}
