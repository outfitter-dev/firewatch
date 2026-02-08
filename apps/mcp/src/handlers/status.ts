import {
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
  type FirewatchConfig,
} from "@outfitter/firewatch-core";
import { getGraphiteStacks } from "@outfitter/firewatch-core/plugins";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";

import { version as mcpVersion } from "../../package.json";
import type { FirewatchParams, McpToolResult } from "../types";
import { textResult } from "../utils/formatting";

function redactConfig(config: FirewatchConfig): FirewatchConfig {
  if (!config.github_token) {
    return config;
  }

  return {
    ...config,
    github_token: "***",
  };
}

function getCacheStats(): {
  repos: number;
  entries: number;
  size_bytes: number;
  last_sync?: string;
} {
  // Check if database exists
  const dbFile = Bun.file(PATHS.db);
  if (!dbFile.size) {
    return { repos: 0, entries: 0, size_bytes: 0 };
  }

  const db = getDatabase();

  // Get counts from SQLite
  const repos = getRepos(db).length;
  const entries = countEntries(db);
  const size_bytes = dbFile.size;

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

  return { repos, entries, size_bytes, ...(last_sync && { last_sync }) };
}

export async function handleStatus(
  params: FirewatchParams
): Promise<McpToolResult> {
  await ensureDirectories();

  const config = await loadConfig();
  const detected = await detectRepo();
  const auth = await detectAuth(config.github_token);
  const configPaths = await getConfigPaths();
  const projectPath = await getProjectConfigPath();
  const cache = getCacheStats();

  const graphite =
    detected.repo && (await getGraphiteStacks())
      ? { enabled: true }
      : { enabled: false };

  const output = {
    version: mcpVersion,
    auth: {
      ok: auth.isOk(),
      source: auth.isOk() ? auth.value.source : "none",
      ...(auth.isErr() && { error: auth.error.message }),
    },
    config: {
      paths: {
        user: configPaths.user,
        project: projectPath,
      },
      values: redactConfig(config),
    },
    repo: detected.repo,
    graphite,
    cache,
  };

  const short = Boolean(params.short || params.status_short);
  if (short) {
    return textResult(
      JSON.stringify({
        auth: output.auth,
        repo: output.repo,
        cache: output.cache,
      })
    );
  }

  return textResult(JSON.stringify(output));
}

export async function handleDoctor(
  params: FirewatchParams
): Promise<McpToolResult> {
  await ensureDirectories();

  const config = await loadConfig();
  const auth = await detectAuth(config.github_token);
  const detected = await detectRepo();
  const configPaths = await getConfigPaths();
  const projectPath = await getProjectConfigPath();

  const issues: { check: string; message: string }[] = [];

  let githubOk = false;
  let githubChecked = false;
  let githubStatus: number | undefined;
  const authToken = auth.isOk() ? auth.value.token : undefined;
  try {
    const response = await fetch("https://api.github.com/rate_limit", {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
    githubStatus = response.status;
    githubOk = response.ok;
    githubChecked = true;
  } catch (error) {
    issues.push({
      check: "github_api",
      message:
        error instanceof Error ? error.message : "GitHub API unreachable",
    });
  }

  if (githubChecked && !githubOk) {
    issues.push({
      check: "github_api",
      message: `GitHub API request failed${githubStatus ? ` (status ${githubStatus})` : ""}`,
    });
  }

  if (auth.isErr()) {
    issues.push({
      check: "auth",
      message: auth.error.message,
    });
  }

  let cacheWritable = true;
  try {
    await access(PATHS.cache, fsConstants.W_OK);
  } catch {
    cacheWritable = false;
    issues.push({
      check: "cache",
      message: "Cache directory is not writable.",
    });
  }

  const graphiteEnabled = detected.repo && (await getGraphiteStacks()) !== null;

  const output = {
    ok: issues.length === 0,
    checks: {
      github_api: {
        ok: githubOk,
        status: githubStatus,
      },
      auth: {
        ok: auth.isOk(),
        source: auth.isOk() ? auth.value.source : "none",
        ...(auth.isErr() && { error: auth.error.message }),
      },
      config: {
        ok: true,
        user: configPaths.user,
        project: projectPath,
      },
      cache: {
        ok: cacheWritable,
        path: PATHS.cache,
      },
      repo: {
        ok: Boolean(detected.repo),
        repo: detected.repo ?? null,
        source: detected.source ?? null,
      },
      graphite: {
        ok: Boolean(graphiteEnabled),
        enabled: Boolean(graphiteEnabled),
      },
      ...(params.fix && { fix_applied: false }),
    },
    issues,
  };

  return textResult(JSON.stringify(output));
}
