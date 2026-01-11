import { Command } from "commander";

import {
  GitHubClient,
  detectAuth,
  detectRepo,
  ensureDirectories,
  parseSince,
  syncRepo,
} from "../../core";

export const syncCommand = new Command("sync")
  .description("Fetch and update PR data from GitHub")
  .argument("[repo]", "Repository to sync (owner/repo format, or auto-detect)")
  .option("--full", "Force full refresh (ignore cursor)")
  .option("--since <duration>", "Only PRs updated since (e.g., 7d, 24h)")
  .option("--with-graphite", "Include Graphite stack metadata")
  .action(async (repo: string | undefined, options) => {
    try {
      await ensureDirectories();

      // Detect authentication
      const auth = await detectAuth();
      if (!auth.token) {
        console.error(auth.error);
        process.exit(1);
      }

      const client = new GitHubClient(auth.token);

      // Determine repos to sync
      let repos: string[] = [];

      if (repo) {
        repos = [repo];
      } else {
        // Try to auto-detect from current directory
        const detected = await detectRepo();
        if (detected.repo) {
          console.error(
            `Detected ${detected.repo} from ${detected.source}`
          );
          repos = [detected.repo];
        }
      }

      if (repos.length === 0) {
        console.error(
          "No repository detected. Use: fw sync owner/repo\n" +
            "Or run from within a git repo with a GitHub remote."
        );
        process.exit(1);
      }

      // Sync each repo
      for (const r of repos) {
        console.error(`Syncing ${r}...`);

        const result = await syncRepo(client, r, {
          ...(options.full && { full: true }),
          ...(options.since && { since: parseSince(options.since) }),
          plugins: [], // TODO: Load Graphite plugin if --with-graphite
        });

        console.error(
          `  ${result.prsProcessed} PRs processed, ${result.entriesAdded} entries added`
        );
      }

      console.error("Sync complete.");
    } catch (error) {
      console.error(
        "Sync failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
