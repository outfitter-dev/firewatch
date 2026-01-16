import {
  PATHS,
  detectRepo,
  ensureDirectories,
  getRepoCachePath,
  parseRepoCacheFilename,
  readEntriesJsonl,
  readJsonl,
  type SyncMetadata,
} from "@outfitter/firewatch-core";
import { Command } from "commander";
import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";

import { writeJsonLine } from "../utils/json";
import { colors, formatRelativeTime, shouldOutputJson } from "../utils/tty";

interface CacheStats {
  repo: string;
  entries: number;
  last_sync: string | null;
  cache_path: string;
  size_bytes: number;
}

interface CacheCommandOptions {
  json?: boolean;
  noJson?: boolean;
}

async function getCacheStats(repo: string): Promise<CacheStats | null> {
  const cachePath = getRepoCachePath(repo);

  if (!existsSync(cachePath)) {
    return null;
  }

  const entries = await readEntriesJsonl(cachePath);
  const stats = statSync(cachePath);

  // Read meta for last sync time
  const allMeta = await readJsonl<SyncMetadata>(PATHS.meta);
  const repoMeta = allMeta.find((m) => m.repo === repo);
  const lastSync = repoMeta?.last_sync ?? null;

  return {
    repo,
    entries: entries.length,
    last_sync: lastSync,
    cache_path: cachePath,
    size_bytes: stats.size,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function listCachedRepos(): string[] {
  if (!existsSync(PATHS.repos)) {
    return [];
  }

  const files = readdirSync(PATHS.repos).filter((f) => f.endsWith(".jsonl"));
  return files.map((file) => {
    const filename = file.replace(".jsonl", "");
    return parseRepoCacheFilename(filename);
  });
}

export const cacheCommand = new Command("cache")
  .description("View and manage the local cache")
  .option("--json", "Force JSON output")
  .option("--no-json", "Force human-readable output")
  .action(async (options: CacheCommandOptions) => {
    await ensureDirectories();
    const detected = await detectRepo();

    if (!detected.repo) {
      console.error(
        "No repository detected. Use: fw cache list\n" +
          "Or run from within a git repo with a GitHub remote."
      );
      process.exit(1);
    }

    const stats = await getCacheStats(detected.repo);

    if (!stats) {
      console.error(
        `No cache for ${detected.repo}. Run \`fw sync\` to fetch PR activity.`
      );
      return;
    }

    if (shouldOutputJson(options)) {
      await writeJsonLine(stats);
    } else {
      console.log(colors.bold(stats.repo));
      console.log(`  Entries: ${stats.entries}`);
      console.log(`  Size: ${formatBytes(stats.size_bytes)}`);
      console.log(`  Path: ${stats.cache_path}`);
      if (stats.last_sync) {
        console.log(`  Last sync: ${formatRelativeTime(stats.last_sync)}`);
      }
    }
  });

// Subcommand: fw cache purge
cacheCommand
  .command("purge")
  .description("Clear the cache for a repository")
  .argument("[repo]", "Repository (auto-detected if omitted)")
  .action(async (repo: string | undefined) => {
    await ensureDirectories();
    const detected = await detectRepo();
    const targetRepo = repo ?? detected.repo;

    if (!targetRepo) {
      console.error(
        "No repository specified or detected.\n" +
          "Usage: fw cache purge <owner/repo>"
      );
      process.exit(1);
    }

    const cachePath = getRepoCachePath(targetRepo);
    if (existsSync(cachePath)) {
      unlinkSync(cachePath);
      console.error(`Purged cache for ${targetRepo}`);
    } else {
      console.error(`No cache found for ${targetRepo}`);
    }
  });

// Subcommand: fw cache list
cacheCommand
  .command("list")
  .description("List all cached repositories")
  .option("--json", "Output as JSON array")
  .action(async (options: { json?: boolean }) => {
    await ensureDirectories();
    const repos = listCachedRepos();

    if (repos.length === 0) {
      console.error("No cached repositories. Run `fw sync` to fetch data.");
      return;
    }

    if (options.json) {
      await writeJsonLine(repos);
    } else {
      for (const repo of repos) {
        console.log(repo);
      }
      console.error(colors.dim(`\n${repos.length} cached repository(s)`));
    }
  });

// Subcommand: fw cache stats
cacheCommand
  .command("stats")
  .description("Show detailed statistics for all cached repositories")
  .option("--json", "Force JSON output")
  .action(async (options: { json?: boolean }) => {
    await ensureDirectories();
    const repos = listCachedRepos();

    if (repos.length === 0) {
      console.error("No cached repositories. Run `fw sync` to fetch data.");
      return;
    }

    const allStats: CacheStats[] = [];
    for (const repo of repos) {
      const stats = await getCacheStats(repo);
      if (stats) {
        allStats.push(stats);
      }
    }

    if (options.json) {
      await writeJsonLine(allStats);
      return;
    }

    // Print table header
    console.log(
      `${colors.bold("Repository".padEnd(40))} ${colors.bold("Entries".padStart(10))} ${colors.bold("Size".padStart(10))} ${colors.bold("Last Sync".padStart(12))}`
    );
    console.log("\u2500".repeat(75));

    let totalEntries = 0;
    let totalBytes = 0;

    for (const stats of allStats) {
      const repoName = stats.repo.length > 38 ? `${stats.repo.slice(0, 37)}...` : stats.repo;
      const lastSync = stats.last_sync
        ? formatRelativeTime(stats.last_sync)
        : "never";

      console.log(
        `${repoName.padEnd(40)} ${String(stats.entries).padStart(10)} ${formatBytes(stats.size_bytes).padStart(10)} ${lastSync.padStart(12)}`
      );

      totalEntries += stats.entries;
      totalBytes += stats.size_bytes;
    }

    console.log("\u2500".repeat(75));
    console.log(
      colors.dim(
        `Total: ${allStats.length} repos, ${totalEntries} entries, ${formatBytes(totalBytes)}`
      )
    );
  });
