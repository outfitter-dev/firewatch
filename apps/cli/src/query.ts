/**
 * Query orchestration module for CLI commands.
 *
 * This module extracts the orchestration logic from the query handlers
 * to reduce their complexity and improve maintainability.
 */
import {
  type FirewatchConfig,
  type FirewatchEntry,
  type PrState,
  type QueryOptions,
  detectRepo,
  ensureDirectories,
  getAckedIds,
  loadConfig,
  queryEntries,
} from "@outfitter/firewatch-core";

import { buildActionableSummary, printActionableSummary } from "./actionable";
import {
  type AuthorFilters,
  type QueryCommandOptions,
  ensureFreshRepos,
  parsePrList,
  parseTypes,
  resolveAuthorFilters,
  resolveRepoFilter,
  resolveReposToSync,
  resolveSinceFilter,
} from "./query-helpers";
import { ensureGraphiteMetadata } from "./stack";
import { outputStructured } from "./utils/json";
import { resolveStates } from "./utils/states";
import { shouldOutputJson } from "./utils/tty";
import { outputWorklist } from "./worklist";

// ============================================================================
// Types
// ============================================================================

/**
 * Resolved context for query execution.
 */
export interface CliQueryContext {
  config: FirewatchConfig;
  detectedRepo: string | null;
  repoFilter: string | undefined;
  reposToSync: string[];
  states: PrState[] | undefined;
  types: FirewatchEntry["type"][];
  prList: number[];
  effectiveSince: Date | undefined;
  beforeDate: Date | undefined;
  authorFilters: AuthorFilters;
  outputJson: boolean;
}

// ============================================================================
// Phase 1: Validation
// ============================================================================

/**
 * Validate mutually exclusive options.
 * Throws with user-friendly error message if validation fails.
 */
export function validateQueryOptions(options: QueryCommandOptions): void {
  if (options.sync === false && options.syncFull) {
    throw new Error("--no-sync cannot be used with --sync-full.");
  }
  if (options.mine && options.reviews) {
    throw new Error("Cannot use both --mine and --reviews together.");
  }

  if (options.orphaned && (options.open || options.ready || options.draft)) {
    throw new Error(
      "--orphaned cannot be used with --open, --ready, or --draft (orphaned implies merged/closed PRs)."
    );
  }
}

// ============================================================================
// Phase 2: Build Context
// ============================================================================

/**
 * Build the query context from parsed options.
 * This includes loading config, detecting repo, and resolving all filters.
 */
export async function buildCliQueryContext(
  options: QueryCommandOptions
): Promise<CliQueryContext> {
  // Parse types and PR list (may throw)
  const types = parseTypes(options.type);
  const prList = parsePrList(options.pr);

  // Load config and detect repo
  const config = await loadConfig();
  const detected = await detectRepo();
  const detectedRepo = detected.repo ?? null;

  // Determine output format
  const outputJson = options.summary
    ? true
    : shouldOutputJson(options, config.output?.default_format);

  // Resolve repo filter
  const repoFilter = resolveRepoFilter(options, detectedRepo);
  if (!repoFilter && !options.all) {
    throw new Error(
      "No repository detected. Use --repo owner/repo or run inside a git repo."
    );
  }

  // Resolve repos to sync
  const reposToSync = resolveReposToSync(options, config, detectedRepo);

  // Resolve states from options
  const states = resolveStates({
    ...(options.state && { state: options.state }),
    ...(options.open && { open: true }),
    ...(options.ready && { ready: true }),
    ...(options.closed && { closed: true }),
    ...(options.draft && { draft: true }),
    ...(options.orphaned && { orphaned: true }),
  });

  // Resolve author filters
  const authorFilters = resolveAuthorFilters(options, config);

  // Resolve effective since
  const effectiveSince = resolveSinceFilter(options.since, options.orphaned);

  // Parse before date
  let beforeDate: Date | undefined;
  if (options.before) {
    beforeDate = new Date(options.before);
    if (Number.isNaN(beforeDate.getTime())) {
      throw new TypeError(
        `Invalid --before date: ${options.before}. Use ISO format (e.g., 2024-01-15).`
      );
    }
  }

  return {
    config,
    detectedRepo,
    repoFilter,
    reposToSync,
    states,
    types,
    prList,
    effectiveSince,
    beforeDate,
    authorFilters,
    outputJson,
  };
}

// ============================================================================
// Phase 3: Build Query Filters
// ============================================================================

/**
 * Build query options for queryEntries() from context.
 */
export function buildCliQueryFilters(
  context: CliQueryContext,
  options: QueryCommandOptions
): QueryOptions {
  const { repoFilter, prList, types, states, effectiveSince, authorFilters } =
    context;

  return {
    filters: {
      ...(repoFilter && { repo: repoFilter }),
      ...(prList.length > 0 && {
        pr: prList.length === 1 ? prList[0] : prList,
      }),
      ...(types.length > 0 && { type: types }),
      ...(states && { states }),
      ...(options.label && { label: options.label }),
      ...(effectiveSince && { since: effectiveSince }),
      ...(context.beforeDate && { before: context.beforeDate }),
      ...(authorFilters.excludeAuthors && {
        excludeAuthors: authorFilters.excludeAuthors,
      }),
      ...(authorFilters.excludeBots && { excludeBots: true }),
      ...(authorFilters.botPatterns && {
        botPatterns: authorFilters.botPatterns,
      }),
      ...(options.orphaned && { orphaned: true }),
      ...(options.includeFrozen && { includeFrozen: true }),
    },
    ...(options.limit !== undefined && { limit: options.limit }),
    ...(options.offset !== undefined && { offset: options.offset }),
  };
}

// ============================================================================
// Phase 4: Client-side Filters
// ============================================================================

/**
 * Apply client-side filters that can't be done in SQL query.
 */
export function applyClientSideFilters(
  entries: FirewatchEntry[],
  context: CliQueryContext,
  options: QueryCommandOptions
): FirewatchEntry[] {
  let filtered = entries;
  const { prList, authorFilters, config, beforeDate } = context;

  // Filter by PR list (redundant but ensures correctness)
  if (prList.length > 0) {
    const prSet = new Set(prList);
    filtered = filtered.filter((entry) => prSet.has(entry.pr));
  }

  // Filter by author include list
  if (authorFilters.includeAuthors.length > 0) {
    const includeSet = new Set(
      authorFilters.includeAuthors.map((a) => a.toLowerCase())
    );
    filtered = filtered.filter((entry) =>
      includeSet.has(entry.author.toLowerCase())
    );
  }

  // Filter by before date (for index.ts which doesn't pass to queryEntries)
  if (beforeDate && options.before) {
    filtered = filtered.filter(
      (entry) => new Date(entry.created_at) < beforeDate
    );
  }

  // Filter by mine/reviews
  if (options.mine || options.reviews) {
    const username = config.user?.github_username;
    if (!username) {
      throw new Error(
        "Set user.github_username in config for --mine/--reviews."
      );
    }
    filtered = filtered.filter((entry) =>
      options.mine
        ? entry.pr_author === username
        : entry.pr_author !== username
    );
  }

  return filtered;
}

// ============================================================================
// Phase 5: Output Rendering
// ============================================================================

/**
 * Render query output in the appropriate format.
 */
export async function renderCliQueryOutput(
  entries: FirewatchEntry[],
  context: CliQueryContext,
  options: QueryCommandOptions
): Promise<void> {
  const { outputJson } = context;

  // Summary output
  if (options.summary) {
    const wrote = await outputWorklist(entries);
    if (!wrote && process.stderr.isTTY) {
      console.error("No entries found for summary.");
    }
    return;
  }

  // JSON output
  if (outputJson) {
    if (entries.length === 0 && process.stderr.isTTY) {
      console.error("No entries matched the query filters.");
    }
    await outputStructured(entries, "jsonl");
    return;
  }

  // Human-readable output
  await renderHumanReadableOutput(entries, context, options);
}

/**
 * Render human-readable actionable summary output.
 */
async function renderHumanReadableOutput(
  entries: FirewatchEntry[],
  context: CliQueryContext,
  options: QueryCommandOptions
): Promise<void> {
  const { repoFilter, config } = context;
  const repoLabel = repoFilter ?? (options.all ? "all" : "unknown");
  const username = config.user?.github_username;
  const actionableEntries = await ensureGraphiteMetadata(entries);
  const ackedIds = await getAckedIds(options.all ? undefined : repoFilter);

  if (options.mine || options.reviews) {
    const perspective = options.mine ? "mine" : "reviews";
    const summary = buildActionableSummary(
      repoLabel,
      actionableEntries,
      perspective,
      username,
      options.orphaned,
      { ackedIds }
    );
    await printActionableSummary(summary);
    return;
  }

  if (username) {
    const mineSummary = buildActionableSummary(
      repoLabel,
      actionableEntries,
      "mine",
      username,
      options.orphaned,
      { ackedIds }
    );
    await printActionableSummary(mineSummary);

    const reviewSummary = buildActionableSummary(
      repoLabel,
      actionableEntries,
      "reviews",
      username,
      options.orphaned,
      { ackedIds }
    );
    await printActionableSummary(reviewSummary);
  } else {
    const summary = buildActionableSummary(
      repoLabel,
      actionableEntries,
      undefined,
      undefined,
      options.orphaned,
      { ackedIds }
    );
    await printActionableSummary(summary);
  }
}

// ============================================================================
// Main Orchestration
// ============================================================================

/**
 * Execute a CLI query with full orchestration.
 * This is the main entry point that coordinates all phases.
 */
export async function executeCliQuery(
  options: QueryCommandOptions
): Promise<void> {
  // Phase 1: Validate options
  validateQueryOptions(options);

  // Phase 2: Build context
  const context = await buildCliQueryContext(options);

  // Ensure directories exist
  await ensureDirectories();

  // Phase 2.5: Sync repos if needed
  await ensureFreshRepos(
    context.reposToSync,
    options,
    context.config,
    context.detectedRepo,
    context.states
  );

  // Phase 3: Execute query
  const queryOptions = buildCliQueryFilters(context, options);
  const entries = await queryEntries(queryOptions);

  // Phase 4: Apply client-side filters
  const filtered = applyClientSideFilters(entries, context, options);

  // Phase 5: Render output
  await renderCliQueryOutput(filtered, context, options);
}
