/**
 * Unified sync command for cache synchronization and management.
 *
 * Replaces `fw query --refresh` and `fw cache clear` with a single command.
 *
 * Delegates auth, Graphite plugin detection, cache clearing, and syncRepo
 * orchestration to syncHandler. The CLI layer handles spinners, dry-run
 * preview, JSON output, and scope iteration.
 */
import {
  type FirewatchConfig,
  type SyncScope,
  type SyncOutput,
  getDatabase,
  getSyncMeta,
  loadConfig,
  syncHandler,
} from "@outfitter/firewatch-core";
import { Command, Option } from "commander";
import ora, { type Ora } from "ora";

import { applyCommonOptions } from "../query-helpers";
import { resolveRepoOrThrow } from "../repo";
import { outputStructured } from "../utils/json";
import { shouldOutputJson } from "../utils/tty";
import { silentLogger } from "@outfitter/firewatch-shared";

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
  debug?: boolean;
  noColor?: boolean;
}

interface SyncOutputResult {
  event: "sync_complete";
  repo: string;
  scope: SyncScope;
  mode: "full" | "incremental";
  entries: number;
  duration_ms: number;
  cleared?: boolean;
}

interface SyncDisplayContext {
  config: FirewatchConfig;
  repo: string;
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
 * Handle dry-run output.
 * Shows what would be synced without executing.
 */
function handleDryRun(
  ctx: SyncDisplayContext,
  db: ReturnType<typeof getDatabase>
): void {
  const meta = getSyncMeta(db, ctx.repo, ctx.scope);
  if (meta?.last_sync) {
    const lastSyncDate = new Date(meta.last_sync).toISOString().split("T")[0];
    const mode = ctx.isFullSync ? "full" : "incremental";
    console.log(
      `Would sync ${ctx.repo} (${ctx.scope}, ${mode} from ${lastSyncDate}, ${meta.pr_count ?? 0} PRs cached)`
    );
  } else {
    console.log(
      `Would sync ${ctx.repo} (${ctx.scope}, full, no previous sync)`
    );
  }
}

/**
 * Output sync results in the appropriate format.
 */
async function outputResults(
  ctx: SyncDisplayContext,
  options: SyncCommandOptions,
  output: SyncOutput,
  spinner: Ora | null
): Promise<void> {
  const repoResult = output.repos.find((r) => r.repo === ctx.repo);
  const entriesAdded = repoResult?.entries ?? 0;

  if (ctx.outputJson) {
    const result: SyncOutputResult = {
      event: "sync_complete",
      repo: ctx.repo,
      scope: ctx.scope,
      mode: ctx.isFullSync ? "full" : "incremental",
      entries: entriesAdded,
      duration_ms: output.duration,
      ...(options.clear && { cleared: true }),
    };
    await outputStructured(result, "jsonl");
    return;
  }

  if (options.quiet) {
    spinner?.stop();
    return;
  }

  const modeLabel = ctx.isFullSync ? "full" : "incremental";
  const entriesLabel = entriesAdded === 1 ? "entry" : "entries";
  spinner?.succeed(
    `Synced ${ctx.repo} (${ctx.scope}, ${modeLabel}). ${entriesAdded} ${entriesLabel} (${formatDuration(output.duration)})`
  );
}

/**
 * Create a spinner for human output.
 */
function createSpinner(
  ctx: SyncDisplayContext,
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
  applyCommonOptions(options);

  const config: FirewatchConfig = await loadConfig();
  const repo = await resolveRepoOrThrow(repoArg);
  const db = getDatabase();
  const outputJson = shouldOutputJson(options, config.output?.default_format);
  const isFullSync = Boolean(options.full || options.clear);
  const scopes = resolveSyncScopes(options);

  // Handle --dry-run (show what would be synced without executing)
  if (options.dryRun) {
    if (options.clear && !options.quiet) {
      console.error(`Would clear cache for ${repo}`);
    }
    for (const scope of scopes) {
      handleDryRun({ config, repo, outputJson, isFullSync, scope }, db);
    }
    return;
  }

  // Delegate auth + plugin resolution + sync to handler
  for (const scope of scopes) {
    const ctx: SyncDisplayContext = {
      config,
      repo,
      outputJson,
      isFullSync,
      scope,
    };
    const spinner = createSpinner(ctx, options);

    const result = await syncHandler(
      {
        repos: [repo],
        clear: options.clear,
        full: isFullSync,
      },
      {
        config,
        db,
        logger: silentLogger,
      }
    );

    if (result.isErr()) {
      spinner?.fail(
        `Sync failed: ${result.error.message}`
      );
      console.error(result.error.message);
      process.exit(1);
    }

    await outputResults(ctx, options, result.value, spinner);
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
  .option("--debug", "Enable debug logging")
  .option("--no-color", "Disable color output")
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
