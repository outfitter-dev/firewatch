import {
  GitHubClient,
  detectAuth,
  detectRepo,
  ensureDirectories,
  getDatabase,
  getSyncMeta,
  parseDurationMs,
  syncRepo,
  type FirewatchConfig,
  type PrState,
  type SyncScope,
} from "@outfitter/firewatch-core";
import {
  getGraphiteStacks,
  graphitePlugin,
} from "@outfitter/firewatch-core/plugins";

import { DEFAULT_STALE_THRESHOLD, resolveSyncScopes } from "../utils/parsing";

export function isFullRepo(value: string): boolean {
  return /^[^/]+\/[^/]+$/.test(value);
}

export function hasRepoCache(repo: string, scope: SyncScope): boolean {
  const db = getDatabase();
  const meta = getSyncMeta(db, repo, scope);
  return meta !== null;
}

export async function resolveRepo(repo?: string): Promise<string | null> {
  if (repo) {
    return repo;
  }

  const detected = await detectRepo();
  if (detected.repo) {
    return detected.repo;
  }

  return null;
}

export async function ensureRepoCache(
  repo: string,
  config: FirewatchConfig,
  detectedRepo: string | null,
  scope: SyncScope
): Promise<void> {
  if (hasRepoCache(repo, scope)) {
    return;
  }

  await ensureDirectories();

  const auth = await detectAuth(config.github_token);
  if (auth.isErr()) {
    throw new Error(auth.error.message);
  }

  const graphiteEnabled =
    detectedRepo === repo && (await getGraphiteStacks()) !== null;
  const plugins = graphiteEnabled ? [graphitePlugin] : [];
  const client = new GitHubClient(auth.value.token);
  await syncRepo(client, repo, { plugins, scope });
}

export async function ensureRepoCacheIfNeeded(
  repoFilter: string | undefined,
  config: FirewatchConfig,
  detectedRepo: string | null,
  states: PrState[],
  options: { noSync?: boolean } = {}
): Promise<void> {
  if (!repoFilter || !isFullRepo(repoFilter)) {
    return;
  }

  const scopes = resolveSyncScopes(states);

  if (options.noSync) {
    for (const scope of scopes) {
      if (!hasRepoCache(repoFilter, scope)) {
        throw new Error(`No-sync mode: no cache for ${repoFilter} (${scope}).`);
      }
    }
    return;
  }

  const autoSync = config.sync?.auto_sync ?? true;
  const threshold = config.sync?.stale_threshold ?? DEFAULT_STALE_THRESHOLD;
  const thresholdResult = parseDurationMs(threshold);
  const fallbackResult = thresholdResult.isErr()
    ? parseDurationMs(DEFAULT_STALE_THRESHOLD)
    : thresholdResult;
  const thresholdMs = fallbackResult.isOk() ? fallbackResult.value : 0;

  const db = getDatabase();

  for (const scope of scopes) {
    const hasCached = hasRepoCache(repoFilter, scope);
    if (!hasCached) {
      await ensureRepoCache(repoFilter, config, detectedRepo, scope);
      continue;
    }

    if (!autoSync) {
      continue;
    }

    const repoMeta = getSyncMeta(db, repoFilter, scope);
    const lastSync = repoMeta?.last_sync;
    if (!lastSync) {
      await ensureRepoCache(repoFilter, config, detectedRepo, scope);
      continue;
    }

    const ageMs = Date.now() - new Date(lastSync).getTime();
    if (ageMs > thresholdMs) {
      await ensureRepoCache(repoFilter, config, detectedRepo, scope);
    }
  }
}
