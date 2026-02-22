import { Result } from "@outfitter/contracts";
import type { Database } from "bun:sqlite";

import { detectAuth, type AuthSource } from "../auth";
import { ensureDirectories, PATHS } from "../cache";
import { getConfigPaths, getProjectConfigPath } from "../config";
import { getGraphiteStacks } from "../plugins";
import { detectRepo } from "../repo-detect";
import { countEntries, getAllSyncMeta, getRepos } from "../repository";
import type { HandlerContext } from "./types";

// =============================================================================
// Types
// =============================================================================

/** Input parameters for the status handler. */
export interface StatusInput {
  /** Display compact single-line output */
  short?: boolean;
  /** Version string provided by the calling transport (CLI or MCP) */
  version: string;
}

/** Cache statistics from the SQLite database. */
export interface CacheStats {
  /** Number of tracked repositories */
  repos: number;
  /** Total number of cached entries */
  entries: number;
  /** Database file size in bytes (unavailable for in-memory databases) */
  size_bytes?: number;
  /** Most recent sync time (ISO 8601) across all repos */
  last_sync?: string;
}

/** Structured output from the status handler. */
export interface StatusOutput {
  /** Version of the calling transport */
  version: string;
  /** Authentication state */
  auth: {
    ok: boolean;
    source: AuthSource;
    username?: string;
    error?: string;
  };
  /** Configuration file paths and existence checks */
  config: {
    user: { path: string; exists: boolean };
    project?: { path: string; exists: boolean };
  };
  /** Detected repository */
  repo: {
    name?: string;
    source?: string;
  };
  /** Graphite stack provider availability */
  graphite: { available: boolean };
  /** Cache statistics */
  cache: CacheStats;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Compute cache statistics from the database.
 *
 * This is a pure query against the provided database handle -- it does not
 * touch the filesystem for DB size (callers can add size_bytes if needed).
 *
 * @param db - SQLite database handle
 * @returns Cache statistics (repos, entries, last sync time)
 */
export function getCacheStats(db: Database): CacheStats {
  const repos = getRepos(db).length;
  const entries = countEntries(db);

  let last_sync: string | undefined;
  const syncMeta = getAllSyncMeta(db);
  for (const meta of syncMeta) {
    if (!meta.last_sync) {
      continue;
    }
    if (!last_sync || meta.last_sync > last_sync) {
      last_sync = meta.last_sync;
    }
  }

  return {
    repos,
    entries,
    ...(last_sync && { last_sync }),
  };
}

// =============================================================================
// Handler
// =============================================================================

/**
 * Gather Firewatch status information.
 *
 * Checks authentication, configuration, detected repository, Graphite
 * availability, and cache statistics. Returns a structured payload that
 * each transport (CLI, MCP) can format independently.
 *
 * @param input - Status input options
 * @param ctx - Handler context with config, db, and logger
 * @returns Result containing StatusOutput on success
 */
export async function statusHandler(
  input: StatusInput,
  ctx: HandlerContext
): Promise<Result<StatusOutput, Error>> {
  await ensureDirectories();

  // Auth
  const authResult = await detectAuth(ctx.config.github_token);
  const authOk = authResult.isOk();
  const authSource: AuthSource = authOk ? authResult.value.source : "none";

  let username: string | undefined;
  if (authOk) {
    try {
      const { GitHubClient } = await import("../github");
      const client = new GitHubClient(authResult.value.token);
      const loginResult = await client.fetchViewerLogin();
      if (loginResult.isOk()) {
        username = loginResult.value;
      }
    } catch {
      ctx.logger.debug("Failed to fetch viewer login");
    }
  }

  // Config paths
  const configPaths = await getConfigPaths();
  const projectPath = await getProjectConfigPath();
  const userExists = await Bun.file(configPaths.user).exists();
  const projectExists = projectPath
    ? await Bun.file(projectPath).exists()
    : false;

  // Repository detection
  const detected = await detectRepo();

  // Graphite
  let graphiteAvailable = false;
  if (detected.repo) {
    graphiteAvailable = (await getGraphiteStacks()) !== null;
  }

  // Cache
  const cache = getCacheStats(ctx.db);

  // Database file size (not available for :memory: databases)
  try {
    const dbFile = Bun.file(PATHS.db);
    const size = dbFile.size;
    if (size > 0) {
      cache.size_bytes = size;
    }
  } catch {
    // DB file may not exist (e.g. tests with :memory:)
  }

  const output: StatusOutput = {
    version: input.version,
    auth: {
      ok: authOk,
      source: authSource,
      ...(username && { username }),
      ...(authResult.isErr() && { error: authResult.error.message }),
    },
    config: {
      user: { path: configPaths.user, exists: userExists },
      ...(projectPath && {
        project: { path: projectPath, exists: projectExists },
      }),
    },
    repo: {
      ...(detected.repo && { name: detected.repo }),
      ...(detected.source && { source: detected.source }),
    },
    graphite: { available: graphiteAvailable },
    cache,
  };

  return Result.ok(output);
}
