import {
  GitHubClient,
  PATHS,
  countEntries,
  detectAuth,
  detectRepo,
  ensureDirectories,
  getAllSyncMeta,
  getConfigPaths,
  getDatabase,
  getProjectConfigPath,
  getRepos,
  loadConfig,
  type AuthResult,
  type RepoDetectResult,
} from "@outfitter/firewatch-core";
import { getGraphiteStacks } from "@outfitter/firewatch-core/plugins";
import { Command, Option } from "commander";
import { existsSync, statSync } from "node:fs";

import { version } from "../../package.json";
import { outputStructured } from "../utils/json";
import { formatRelativeTime, shouldOutputJson } from "../utils/tty";

interface StatusCommandOptions {
  short?: boolean;
  jsonl?: boolean;
  json?: boolean;
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

function formatAuthLabel(
  authLogin: string | undefined,
  authToken: boolean,
  authSource: string
): string {
  if (authLogin) {
    return `${authLogin} (${authSource})`;
  }
  if (authToken) {
    return `token (${authSource})`;
  }
  return "unauthenticated";
}

function printShortOutput(
  version: string,
  authLogin: string | undefined,
  auth: AuthResult,
  repoName: string | null,
  cache: CacheSummary
): void {
  const authLabel = formatAuthLabel(authLogin, Boolean(auth.token), auth.source);
  const repoLabel = repoName ?? "none";
  const cacheLabel = `${cache.repos} repos, ${cache.entries} entries`;
  const lastSync = cache.last_sync
    ? `, last sync ${formatRelativeTime(cache.last_sync)}`
    : "";
  console.log(
    `Firewatch v${version} | auth=${authLabel} | repo=${repoLabel} | cache=${cacheLabel}${lastSync}`
  );
}

function printFullOutput(
  version: string,
  authLogin: string | undefined,
  auth: AuthResult,
  configPaths: { user: string },
  projectPath: string | null,
  detected: RepoDetectResult,
  graphiteAvailable: boolean,
  cache: CacheSummary
): void {
  console.log(`Firewatch v${version}\n`);
  const authLine = formatAuthLabel(authLogin, Boolean(auth.token), `via ${auth.source}`);
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
  console.log(`Graphite:  ${graphiteAvailable ? "enabled" : "disabled"}`);

  console.log("\nCache:");
  console.log(`  Repos:     ${cache.repos}`);
  console.log(`  Entries:   ${cache.entries}`);
  if (cache.last_sync) {
    console.log(`  Last sync: ${formatRelativeTime(cache.last_sync)}`);
  }
  console.log(`  Size:      ${formatBytes(cache.size_bytes)}`);
}

function getCacheSummary(): CacheSummary {
  // Check if database exists
  if (!existsSync(PATHS.db)) {
    return { repos: 0, entries: 0, size_bytes: 0 };
  }

  const db = getDatabase();

  // Get repo count and entry count from SQLite
  const repos = getRepos(db).length;
  const entries = countEntries(db);

  // Get database file size
  let sizeBytes = 0;
  try {
    const stats = statSync(PATHS.db);
    sizeBytes = stats.size;
  } catch {
    // File might not exist yet
  }

  // Get last sync time from sync metadata
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
    size_bytes: sizeBytes,
    ...(last_sync && { last_sync }),
  };
}

export const statusCommand = new Command("status")
  .description("Show Firewatch state information")
  .option("--short", "Compact single-line output")
  .option("--jsonl", "Force structured output")
  .option("--no-jsonl", "Force human-readable output")
  .addOption(new Option("--json").hideHelp())
  .action(async (options: StatusCommandOptions) => {
    try {
      await ensureDirectories();
      const config = await loadConfig();
      const outputJson = shouldOutputJson(
        options,
        config.output?.default_format
      );

      const configPaths = await getConfigPaths();
      const projectPath = await getProjectConfigPath();
      const userExists = await Bun.file(configPaths.user).exists();
      const projectExists = projectPath
        ? await Bun.file(projectPath).exists()
        : false;

      const detected = await detectRepo();
      const cache = getCacheSummary();

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
        await outputStructured(payload, "jsonl");
        return;
      }

      if (options.short) {
        printShortOutput(version, authLogin, auth, detected.repo, cache);
        return;
      }

      printFullOutput(
        version,
        authLogin,
        auth,
        configPaths,
        projectPath,
        detected,
        graphiteAvailable,
        cache
      );
    } catch (error) {
      console.error(
        "Status failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
