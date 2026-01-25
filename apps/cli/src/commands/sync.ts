/**
 * Unified sync command for cache synchronization and management.
 *
 * Replaces `fw query --refresh` and `fw cache clear` with a single command.
 */
import {
  type FirewatchConfig,
  type SyncResult,
  type SyncScope,
  GitHubClient,
  clearRepo,
  detectAuth,
  getDatabase,
  getSyncMeta,
  loadConfig,
  syncRepo,
} from "@outfitter/firewatch-core";
import {
  getGraphiteStacks,
  graphitePlugin,
} from "@outfitter/firewatch-core/plugins";
import type { Database } from "bun:sqlite";
import { Command, Option } from "commander";
import ora, { type Ora } from "ora";

import { resolveRepoOrThrow } from "../repo";
import { outputStructured } from "../utils/json";
import { shouldOutputJson } from "../utils/tty";

// ============================================================================
// Types
// ============================================================================

interface SyncCommandOptions {
  clear?: boolean;
  full?: boolean;
  dryRun?: boolean;
  quiet?: boolean;
  jsonl?: boolean;
  open?: boolean;
  closed?: boolean;
}

interface SyncOutputResult {
  event: "sync_complete";
  repo: string;
  scope: SyncScope;
  mode: "full" | "incremental";
  entries: number;
  prs: number;
  duration_ms: number;
  cleared?: boolean;
}

interface SyncContext {
  config: FirewatchConfig;
  repo: string;
  db: Database;
  outputJson: boolean;
  isFullSync: boolean;
  scope: SyncScope;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format a duration in milliseconds to a human-readable string.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function resolveSyncScopes(options: SyncCommandOptions): SyncScope[] {
  const scopes = new Set<SyncScope>();
  if (options.open) {
    scopes.add("open");
  }
  if (options.closed) {
    scopes.add("closed");
  }

  if (scopes.size === 0) {
    return ["open"];
  }

  const ordered: SyncScope[] = [];
  if (scopes.has("open")) {
    ordered.push("open");
  }
  if (scopes.has("closed")) {
    ordered.push("closed");
  }
  return ordered;
}

/**
 * Handle cache clearing if requested.
 */
function handleClear(
  ctx: SyncContext,
  options: SyncCommandOptions
): void {
  if (!options.clear) {
    return;
  }

  if (options.dryRun) {
    if (!options.quiet) {
      console.error(`Would clear cache for ${ctx.repo}`);
    }
    return;
  }

  clearRepo(ctx.db, ctx.repo);
  if (!options.quiet && !ctx.outputJson) {
    console.error(`Cleared cache for ${ctx.repo}.`);
  }
}

/**
 * Handle dry-run output.
 * Returns true if this is a dry-run (caller should return early).
 */
function handleDryRun(
  ctx: SyncContext,
  options: SyncCommandOptions
): boolean {
  if (!options.dryRun) {
    return false;
  }

  const meta = getSyncMeta(ctx.db, ctx.repo, ctx.scope);
  if (meta?.last_sync) {
    const lastSyncDate = new Date(meta.last_sync).toISOString().split("T")[0];
    const mode = ctx.isFullSync ? "full" : "incremental";
    console.log(
      `Would sync ${ctx.repo} (${ctx.scope}, ${mode} from ${lastSyncDate}, ${meta.pr_count ?? 0} PRs cached)`
    );
  } else {
    console.log(`Would sync ${ctx.repo} (${ctx.scope}, full, no previous sync)`);
  }
  return true;
}

/**
 * Output sync results in the appropriate format.
 */
async function outputResults(
  ctx: SyncContext,
  options: SyncCommandOptions,
  result: SyncResult,
  durationMs: number,
  spinner: Ora | null
): Promise<void> {
  if (ctx.outputJson) {
    const output: SyncOutputResult = {
      event: "sync_complete",
      repo: ctx.repo,
      scope: ctx.scope,
      mode: ctx.isFullSync ? "full" : "incremental",
      entries: result.entriesAdded,
      prs: result.prsProcessed,
      duration_ms: durationMs,
      ...(options.clear && { cleared: true }),
    };
    await outputStructured(output, "jsonl");
    return;
  }

  if (options.quiet) {
    spinner?.stop();
    return;
  }

  const modeLabel = ctx.isFullSync ? "full" : "incremental";
  const entriesLabel = result.entriesAdded === 1 ? "entry" : "entries";
  spinner?.succeed(
    `Synced ${ctx.repo} (${ctx.scope}, ${modeLabel}). ${result.entriesAdded} ${entriesLabel} (${formatDuration(durationMs)})`
  );
}

/**
 * Create a spinner for human output.
 */
function createSpinner(
  ctx: SyncContext,
  options: SyncCommandOptions
): Ora | null {
  if (options.quiet || ctx.outputJson) {
    return null;
  }

  return ora({
    text: `Syncing ${ctx.repo} (${ctx.scope}${
      ctx.isFullSync ? ", full" : ""
    })...`,
    stream: process.stderr,
    isEnabled: process.stderr.isTTY,
  }).start();
}

// ============================================================================
// Sync Logic
// ============================================================================

/**
 * Execute the sync command.
 */
async function handleSync(
  repoArg: string | undefined,
  options: SyncCommandOptions
): Promise<void> {
  // Build context
  const config: FirewatchConfig = await loadConfig();
  const repo = await resolveRepoOrThrow(repoArg);
  const db = getDatabase();
  const outputJson = shouldOutputJson(options, config.output?.default_format);
  const isFullSync = Boolean(options.full || options.clear);
  const scopes = resolveSyncScopes(options);

  // Handle --clear
  handleClear(
    { config, repo, db, outputJson, isFullSync, scope: scopes[0] ?? "open" },
    options
  );

  // Handle --dry-run
  if (options.dryRun) {
    for (const scope of scopes) {
      handleDryRun(
        { config, repo, db, outputJson, isFullSync, scope },
        options
      );
    }
    return;
  }

  // Authenticate
  const auth = await detectAuth(config.github_token);
  if (!auth.token) {
    console.error("GitHub authentication required.");
    console.error(auth.error ?? "No token found. Run 'gh auth login' or set GITHUB_TOKEN.");
    process.exit(1);
  }

  // Create GitHub client and plugins
  const client = new GitHubClient(auth.token);
  const useGraphite = (await getGraphiteStacks()) !== null;
  const plugins = useGraphite ? [graphitePlugin] : [];

  for (const scope of scopes) {
    const ctx: SyncContext = { config, repo, db, outputJson, isFullSync, scope };
    const startTime = Date.now();
    const spinner = createSpinner(ctx, options);

    try {
      const result = await syncRepo(client, repo, {
        full: isFullSync,
        scope,
        plugins,
      });

      const durationMs = Date.now() - startTime;
      await outputResults(ctx, options, result, durationMs, spinner);
    } catch (error) {
      spinner?.fail(
        `Sync failed: ${error instanceof Error ? error.message : error}`
      );
      throw error;
    }
  }
}

// ============================================================================
// Command Definition
// ============================================================================

export const syncCommand = new Command("sync")
  .description("Sync cache with GitHub")
  .argument("[repo]", "Repository (owner/repo format)")
  .option("--clear", "Clear cache before syncing")
  .option("--full", "Full sync (ignore cursors)")
  .option("--open", "Sync open PRs only")
  .option("--closed", "Sync closed + merged PRs only")
  .option("--dry-run", "Show what would be synced")
  .option("--quiet", "Suppress progress output")
  .option("--jsonl", "Force JSONL output")
  .option("--no-jsonl", "Force human-readable output")
  .addOption(new Option("--json").hideHelp())
  .addHelpText(
    "after",
    `
Examples:
  fw sync                      Sync current repo (incremental, open only)
  fw sync owner/repo           Sync specific repo
  fw sync --full               Full resync (ignore cursors)
  fw sync --open               Sync open PRs only
  fw sync --closed             Sync closed + merged PRs only
  fw sync --clear              Clear cache, then sync
  fw sync --dry-run            Preview sync without executing`
  )
  .action(handleSync);
