import {
  GitHubClient,
  buildShortIdCache,
  detectAuth,
  formatShortId,
  generateShortId,
  parseSince,
  syncRepo,
  type FirewatchConfig,
  type FirewatchEntry,
  type SyncScope,
} from "@outfitter/firewatch-core";
import {
  getGraphiteStacks,
  graphitePlugin,
} from "@outfitter/firewatch-core/plugins";

import type { FirewatchParams } from "../types";

export function resolveSyncRepos(
  params: FirewatchParams,
  config: FirewatchConfig,
  detectedRepo: string | null
): string[] {
  const repos: string[] = [];
  if (params.repo) {
    repos.push(params.repo);
  } else if (config.repos.length > 0) {
    repos.push(...config.repos);
  } else if (detectedRepo) {
    repos.push(detectedRepo);
  }

  return repos;
}

export async function resolveGraphiteEnabled(
  detectedRepo: string | null
): Promise<boolean> {
  if (!detectedRepo) {
    return false;
  }

  return (await getGraphiteStacks()) !== null;
}

export async function performSync(
  repos: string[],
  config: FirewatchConfig,
  detectedRepo: string | null,
  options: { full?: boolean; since?: string; scopes?: SyncScope[] } = {}
): Promise<
  {
    repo: string;
    scope: SyncScope;
    prs_processed: number;
    entries_added: number;
  }[]
> {
  const auth = await detectAuth(config.github_token);
  if (auth.isErr()) {
    throw new Error(auth.error.message);
  }

  const client = new GitHubClient(auth.value.token);
  const graphiteEnabled = await resolveGraphiteEnabled(detectedRepo);
  const scopes =
    options.scopes && options.scopes.length > 0
      ? options.scopes
      : (["open"] satisfies SyncScope[]);

  const results: {
    repo: string;
    scope: SyncScope;
    prs_processed: number;
    entries_added: number;
  }[] = [];

  for (const repo of repos) {
    const useGraphite = graphiteEnabled && repo === detectedRepo;
    for (const scope of scopes) {
      const result = await syncRepo(client, repo, {
        ...(options.full && { full: true }),
        ...(options.since && {
          since: (() => {
            const sinceResult = parseSince(options.since!);
            if (sinceResult.isErr()) {
              throw new Error(sinceResult.error.message);
            }
            return sinceResult.value;
          })(),
        }),
        scope,
        plugins: useGraphite ? [graphitePlugin] : [],
      });

      results.push({
        repo,
        scope,
        prs_processed: result.prsProcessed,
        entries_added: result.entriesAdded,
      });
    }
  }

  return results;
}

export function addShortIds(entries: FirewatchEntry[]): FirewatchEntry[] {
  // Build cache first so short IDs can be resolved in follow-up commands
  buildShortIdCache(entries);

  return entries.map((entry) => {
    if (entry.type !== "comment") {
      return entry;
    }
    return {
      ...entry,
      short_id: formatShortId(generateShortId(entry.id, entry.repo)),
    };
  });
}

export async function enrichGraphite(
  entries: FirewatchEntry[]
): Promise<FirewatchEntry[]> {
  const stacks = await getGraphiteStacks();
  if (!stacks) {
    return entries;
  }

  if (!graphitePlugin.enrich) {
    return entries;
  }

  return Promise.all(entries.map((entry) => graphitePlugin.enrich!(entry)));
}
