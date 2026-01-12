import {
  checkRepo,
  detectRepo,
  ensureDirectories,
  loadConfig,
} from "@outfitter/firewatch-core";
import { Command } from "commander";

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

      for (const r of repos) {
        const result = await checkRepo(r);
        console.log(JSON.stringify(result));
      }
    } catch (error) {
      console.error(
        "Check failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
