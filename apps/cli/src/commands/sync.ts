import {
  GitHubClient,
  type FirewatchConfig,
  detectAuth,
  detectRepo,
  ensureDirectories,
  loadConfig,
  parseSince,
  syncRepo,
} from "@outfitter/firewatch-core";
import {
  getGraphiteStacks,
  graphitePlugin,
} from "@outfitter/firewatch-core/plugins";
import { Command } from "commander";

interface SyncCommandOptions {
  full?: boolean;
  since?: string;
  withGraphite?: boolean;
}

function resolveRepos(
  repo: string | undefined,
  config: FirewatchConfig,
  detectedRepo: string | null,
  detectedSource: string | null
): string[] {
  if (repo) {
    return [repo];
  }
  if (config.repos.length > 0) {
    return config.repos;
  }
  if (detectedRepo) {
    console.error(`Detected ${detectedRepo} from ${detectedSource}`);
    return [detectedRepo];
  }
  return [];
}

async function resolveGraphiteEnabled(
  options: SyncCommandOptions,
  config: FirewatchConfig,
  detectedRepo: string | null
): Promise<boolean> {
  if (options.withGraphite || config.graphite_enabled) {
    return true;
  }
  if (detectedRepo) {
    return (await getGraphiteStacks()) !== null;
  }
  return false;
}

async function syncRepos(
  client: GitHubClient,
  repos: string[],
  options: SyncCommandOptions,
  graphiteEnabled: boolean,
  detectedRepo: string | null
): Promise<void> {
  let warnedGraphite = false;

  for (const r of repos) {
    console.error(`Syncing ${r}...`);

    const useGraphite = graphiteEnabled && detectedRepo === r;
    if (graphiteEnabled && !useGraphite && !warnedGraphite) {
      if (detectedRepo) {
        console.error(
          `Graphite integration is only available for the current repo (${detectedRepo}). Skipping for other repos.`
        );
      } else {
        console.error(
          "Graphite integration is only available when running inside a git repo."
        );
      }
      warnedGraphite = true;
    }

    const result = await syncRepo(client, r, {
      ...(options.full && { full: true }),
      ...(options.since && { since: parseSince(options.since) }),
      plugins: useGraphite ? [graphitePlugin] : [],
    });

    console.error(
      `  ${result.prsProcessed} PRs processed, ${result.entriesAdded} entries added`
    );
  }
}

export const syncCommand = new Command("sync")
  .description("Fetch and update PR data from GitHub")
  .argument("[repo]", "Repository to sync (owner/repo format, or auto-detect)")
  .option("--full", "Force full refresh (ignore cursor)")
  .option("--since <duration>", "Only PRs updated since (e.g., 7d, 24h)")
  .option("--with-graphite", "Include Graphite stack metadata")
  .action(async (repo: string | undefined, options: SyncCommandOptions) => {
    try {
      await ensureDirectories();

      const config = await loadConfig();
      const detected = await detectRepo();
      const detectedRepo = detected.repo;

      // Detect authentication
      const auth = await detectAuth(config.github_token);
      if (!auth.token) {
        console.error(auth.error);
        process.exit(1);
      }

      const client = new GitHubClient(auth.token);

      const repos = resolveRepos(
        repo,
        config,
        detectedRepo,
        detected.source
      );

      if (repos.length === 0) {
        console.error(
          "No repository detected. Use: fw sync owner/repo\n" +
            "Or run from within a git repo with a GitHub remote."
        );
        process.exit(1);
      }

      const graphiteEnabled = await resolveGraphiteEnabled(
        options,
        config,
        detectedRepo
      );

      await syncRepos(client, repos, options, graphiteEnabled, detectedRepo);

      console.error("Sync complete.");
    } catch (error) {
      console.error(
        "Sync failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
