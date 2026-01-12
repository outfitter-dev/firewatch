import {
  checkRepo,
  detectAuth,
  detectRepo,
  ensureDirectories,
  GitHubClient,
  loadConfig,
  type CheckOptions,
} from "@outfitter/firewatch-core";
import { Command } from "commander";

import { writeJsonLine } from "../utils/json";

function resolveRepos(
  repo: string | undefined,
  configRepos: string[],
  detectedRepo: string | null,
  detectedSource: string | null
): string[] {
  if (repo) {
    return [repo];
  }
  if (configRepos.length > 0) {
    return configRepos;
  }
  if (detectedRepo) {
    console.error(`Detected ${detectedRepo} from ${detectedSource}`);
    return [detectedRepo];
  }
  return [];
}

export const checkCommand = new Command("check")
  .description("Refresh staleness hints in the local cache")
  .argument("[repo]", "Repository to check (owner/repo format, or auto-detect)")
  .option("--json", "Output JSONL (default)")
  .action(async (repo: string | undefined) => {
    try {
      await ensureDirectories();

      const config = await loadConfig();
      const detected = await detectRepo();
      const repos = resolveRepos(
        repo,
        config.repos,
        detected.repo,
        detected.source
      );

      if (repos.length === 0) {
        console.error(
          "No repository detected. Use: fw check owner/repo\n" +
            "Or run from within a git repo with a GitHub remote."
        );
        process.exit(1);
      }

      // Authenticate with GitHub to fetch commit files
      const auth = await detectAuth(config.github_token);
      if (!auth.token) {
        console.error(auth.error ?? "No GitHub authentication found");
        process.exit(1);
      }

      const client = new GitHubClient(auth.token);

      for (const r of repos) {
        const parts = r.split("/");
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          console.error(`Invalid repo format: ${r} (expected owner/repo)`);
          continue;
        }
        const owner = parts[0];
        const repoName = parts[1];

        // Create resolver that fetches commit files from GitHub API
        const resolveCommitFiles: CheckOptions["resolveCommitFiles"] = (
          commitId
        ) => client.getCommitFiles(owner, repoName, commitId);

        const result = await checkRepo(r, { resolveCommitFiles });
        await writeJsonLine(result);
      }
    } catch (error) {
      console.error(
        "Check failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
