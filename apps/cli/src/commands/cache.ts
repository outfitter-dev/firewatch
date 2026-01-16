import {
  closeFirewatchDb,
  countEntries,
  getAllSyncMeta,
  getDatabase,
  PATHS,
} from "@outfitter/firewatch-core";
import { Command } from "commander";
import { existsSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";

import { writeJsonLine } from "../utils/json";
import { formatRelativeTime, shouldOutputJson } from "../utils/tty";

interface CacheStatusOptions {
  json?: boolean;
}

interface CacheClearOptions {
  force?: boolean;
  yes?: boolean;
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

function getDatabaseSize(): number {
  let size = 0;

  // Main database file
  if (existsSync(PATHS.db)) {
    size += statSync(PATHS.db).size;
  }

  // WAL file (Write-Ahead Log)
  const walPath = `${PATHS.db}-wal`;
  if (existsSync(walPath)) {
    size += statSync(walPath).size;
  }

  // SHM file (Shared Memory)
  const shmPath = `${PATHS.db}-shm`;
  if (existsSync(shmPath)) {
    size += statSync(shmPath).size;
  }

  return size;
}

const statusSubcommand = new Command("status")
  .description("Show cache status and statistics")
  .option("--json", "Force JSON output")
  .option("--no-json", "Force human-readable output")
  .action(async (options: CacheStatusOptions) => {
    try {
      const db = getDatabase();
      const syncMeta = getAllSyncMeta(db);
      const totalEntries = countEntries(db, {});
      const dbSize = getDatabaseSize();

      let lastSync: string | undefined;
      for (const meta of syncMeta) {
        if (meta.last_sync && (!lastSync || meta.last_sync > lastSync)) {
          lastSync = meta.last_sync;
        }
      }

      const payload = {
        database: PATHS.db,
        repos: syncMeta.length,
        entries: totalEntries,
        size_bytes: dbSize,
        ...(lastSync && { last_sync: lastSync }),
      };

      if (shouldOutputJson(options)) {
        await writeJsonLine(payload);
        return;
      }

      console.log("Cache Status\n");
      console.log(`Database:   ${PATHS.db}`);
      console.log(`Repos:      ${syncMeta.length}`);
      console.log(`Entries:    ${totalEntries}`);
      console.log(`Size:       ${formatBytes(dbSize)}`);
      if (lastSync) {
        console.log(`Last sync:  ${formatRelativeTime(lastSync)}`);
      }
    } catch (error) {
      console.error(
        "Cache status failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });

const clearSubcommand = new Command("clear")
  .description("Clear the cache and reset to fresh state")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("-f, --force", "Force clear even if files cannot be removed")
  .action(async (options: CacheClearOptions) => {
    try {
      if (!options.yes && process.stdin.isTTY) {
        console.log("This will delete all cached data including:");
        console.log(`  - Database: ${PATHS.db}`);
        console.log(`  - Legacy JSONL cache: ${PATHS.repos}`);
        console.log("\nUse --yes to skip this prompt.");
        process.exit(0);
      }

      // Close database before deleting files
      closeFirewatchDb();

      const errors: string[] = [];

      // Remove main database file
      try {
        await rm(PATHS.db, { force: true });
      } catch (err) {
        errors.push(
          `Database: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      // Remove WAL file
      try {
        await rm(`${PATHS.db}-wal`, { force: true });
      } catch (err) {
        errors.push(
          `WAL file: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      // Remove SHM file
      try {
        await rm(`${PATHS.db}-shm`, { force: true });
      } catch (err) {
        errors.push(
          `SHM file: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      // Remove legacy JSONL cache directory
      try {
        await rm(PATHS.repos, { recursive: true, force: true });
      } catch (err) {
        errors.push(
          `JSONL cache: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      // Remove legacy meta file
      try {
        await rm(PATHS.meta, { force: true });
      } catch (err) {
        errors.push(
          `Meta file: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      if (errors.length > 0 && !options.force) {
        console.error("Cache clear encountered errors:");
        for (const error of errors) {
          console.error(`  - ${error}`);
        }
        process.exit(1);
      }

      console.log("Cache cleared. Run `fw` to resync.");
    } catch (error) {
      console.error(
        "Cache clear failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });

export const cacheCommand = new Command("cache")
  .description("Manage the Firewatch cache")
  .addCommand(statusSubcommand)
  .addCommand(clearSubcommand);
