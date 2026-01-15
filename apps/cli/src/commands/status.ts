import { existsSync, readdirSync, statSync } from "node:fs";

import {
  GitHubClient,
  PATHS,
  detectAuth,
  detectRepo,
  ensureDirectories,
  getConfigPaths,
  getProjectConfigPath,
  loadConfig,
  parseRepoCacheFilename,
  readEntriesJsonl,
  readJsonl,
  type SyncMetadata,
} from "@outfitter/firewatch-core";
import { getGraphiteStacks } from "@outfitter/firewatch-core/plugins";
import { Command } from "commander";

import { version } from "../../package.json";
import { writeJsonLine } from "../utils/json";
import { formatRelativeTime, shouldOutputJson } from "../utils/tty";

interface StatusCommandOptions {
  short?: boolean;
  json?: boolean;
  noJson?: boolean;
}

interface CacheSummary {
  repos: number;
  entries: number;
  size_bytes: number;
  last_sync?: string;
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

async function getCacheSummary(): Promise<CacheSummary> {
  if (!existsSync(PATHS.repos)) {
    return { repos: 0, entries: 0, size_bytes: 0 };
  }

  const files = readdirSync(PATHS.repos).filter((f) => f.endsWith(".jsonl"));
  let repos = 0;
  let entries = 0;
  let sizeBytes = 0;

  for (const file of files) {
    const repo = parseRepoCacheFilename(file.replace(".jsonl", ""));
    if (!repo) {
      continue;
    }
    repos += 1;
    const filePath = `${PATHS.repos}/${file}`;
    const stats = statSync(filePath);
    sizeBytes += stats.size;
    const items = await readEntriesJsonl(filePath);
    entries += items.length;
  }

  let last_sync: string | undefined;
  const meta = await readJsonl<SyncMetadata>(PATHS.meta);
  for (const entry of meta) {
    if (!entry.last_sync) {
      continue;
    }
    if (!last_sync || entry.last_sync > last_sync) {
      last_sync = entry.last_sync;
    }
  }

  return {
    repos,
    entries,
    size_bytes: sizeBytes,
    ...(last_sync && { last_sync }),
  };
}

export const statusCommand = new Command("status")
  .description("Show Firewatch state information")
  .option("--short", "Compact single-line output")
  .option("--json", "Force JSON output")
  .option("--no-json", "Force human-readable output")
  .action(async (options: StatusCommandOptions) => {
    try {
      await ensureDirectories();
      const config = await loadConfig();
      const outputJson = shouldOutputJson(options, config.output?.default_format);

      const configPaths = await getConfigPaths();
      const projectPath = await getProjectConfigPath();
      const userExists = await Bun.file(configPaths.user).exists();
      const projectExists = projectPath
        ? await Bun.file(projectPath).exists()
        : false;

      const detected = await detectRepo();
      const cache = await getCacheSummary();

      const auth = await detectAuth(config.github_token);
      let authLogin: string | undefined;
      if (auth.token) {
        try {
          const client = new GitHubClient(auth.token);
          authLogin = await client.fetchViewerLogin();
        } catch {
          authLogin = undefined;
        }
      }

      let graphiteAvailable = false;
      if (detected.repo) {
        graphiteAvailable = (await getGraphiteStacks()) !== null;
      }

      const payload = {
        version,
        auth: {
          ok: Boolean(auth.token),
          source: auth.source,
          ...(authLogin && { username: authLogin }),
          ...(auth.error && { error: auth.error }),
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
        graphite: {
          available: graphiteAvailable,
        },
        cache,
      };

      if (outputJson) {
        await writeJsonLine(payload);
        return;
      }

      if (options.short) {
        let authLabel = "unauthenticated";
        if (authLogin) {
          authLabel = `${authLogin} (${auth.source})`;
        } else if (auth.token) {
          authLabel = `token (${auth.source})`;
        }
        const repoLabel = detected.repo ?? "none";
        const cacheLabel = `${cache.repos} repos, ${cache.entries} entries`;
        const lastSync = cache.last_sync
          ? `, last sync ${formatRelativeTime(cache.last_sync)}`
          : "";
        console.log(
          `Firewatch v${version} | auth=${authLabel} | repo=${repoLabel} | cache=${cacheLabel}${lastSync}`
        );
        return;
      }

      console.log(`Firewatch v${version}\n`);
      let authLine = "unauthenticated";
      if (authLogin) {
        authLine = `${authLogin} (via ${auth.source})`;
      } else if (auth.token) {
        authLine = `token (via ${auth.source})`;
      }
      console.log(`Auth:      ${authLine}`);
      const configLine = [
        projectPath ? `${projectPath} (project)` : null,
        `${configPaths.user} (user)`,
      ]
        .filter(Boolean)
        .join(" + ");
      console.log(`Config:    ${configLine}`);
      console.log(
        `Repo:      ${detected.repo ?? "none"}${detected.source ? ` (${detected.source})` : ""}`
      );
      console.log(
        `Graphite:  ${graphiteAvailable ? "enabled" : "disabled"}`
      );

      console.log("\nCache:");
      console.log(`  Repos:     ${cache.repos}`);
      console.log(`  Entries:   ${cache.entries}`);
      if (cache.last_sync) {
        console.log(`  Last sync: ${formatRelativeTime(cache.last_sync)}`);
      }
      console.log(`  Size:      ${formatBytes(cache.size_bytes)}`);
    } catch (error) {
      console.error(
        "Status failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
