import { Result } from "@outfitter/contracts";

import { mergeExcludeAuthors } from "../authors";
import { queryEntries, type QueryFilters, type QueryOptions } from "../query";
import type { FirewatchEntry, PrState } from "../schema/entry";
import type { WorklistEntry } from "../schema/worklist";
import { parseSince } from "../time";
import { buildWorklist, sortWorklist } from "../worklist";
import type { HandlerContext } from "./types";

// =============================================================================
// Types
// =============================================================================

/** Input parameters for the query handler. */
export interface QueryInput {
  /** Repository filter (owner/repo). */
  repo?: string | undefined;
  /** Filter by PR number(s). */
  pr?: number | number[] | undefined;
  /** Filter by entry type(s). */
  type?: FirewatchEntry["type"][] | undefined;
  /** Filter by PR states. */
  states?: PrState[] | undefined;
  /** Filter by label (partial match). */
  label?: string | undefined;
  /** Filter entries since duration or ISO date (e.g. "24h", "7d"). */
  since?: string | undefined;
  /** Filter entries before ISO date. */
  before?: string | undefined;
  /** Include entries from these authors only. */
  author?: string[] | undefined;
  /** Exclude entries from these authors. */
  excludeAuthor?: string[] | undefined;
  /** Exclude bot authors. */
  noBots?: boolean | undefined;
  /** Show orphaned review comments on merged/closed PRs. */
  orphaned?: boolean | undefined;
  /** Include stale entries (unresolved on merged/closed PRs). */
  stale?: string | boolean | undefined;
  /** Include entries after the freeze timestamp for frozen PRs. */
  includeFrozen?: boolean | undefined;
  /** Filter to PRs authored by configured user. */
  mine?: boolean | undefined;
  /** Filter to PRs where configured user is a reviewer. */
  reviews?: boolean | undefined;
  /** Maximum number of results. */
  limit?: number | undefined;
  /** Skip first N results. */
  offset?: number | undefined;
  /** Return per-PR worklist summary instead of raw entries. */
  summary?: boolean | undefined;
  /** Bot patterns from config (pre-compiled RegExp). */
  botPatterns?: RegExp[] | undefined;
}

/** Structured output from the query handler. */
export interface QueryOutput {
  /** Matching entries (empty when summary is true and worklist is populated). */
  entries: FirewatchEntry[];
  /** Per-PR worklist summary (populated when summary is true). */
  worklist?: WorklistEntry[] | undefined;
  /** Total number of matching entries before limit/offset. */
  total: number;
}

// =============================================================================
// Client-side Filters
// =============================================================================

/**
 * Filter entries by PR numbers (client-side).
 */
function filterByPrs(
  entries: FirewatchEntry[],
  prs: number[]
): FirewatchEntry[] {
  if (prs.length === 0) {
    return entries;
  }
  const targets = new Set(prs);
  return entries.filter((entry) => targets.has(entry.pr));
}

/**
 * Filter entries by entry types (client-side).
 */
function filterByTypes(
  entries: FirewatchEntry[],
  types: FirewatchEntry["type"][]
): FirewatchEntry[] {
  if (types.length === 0) {
    return entries;
  }
  const targets = new Set(types);
  return entries.filter((entry) => targets.has(entry.type));
}

/**
 * Filter entries by author include list (client-side).
 */
function filterByAuthors(
  entries: FirewatchEntry[],
  authors: string[]
): FirewatchEntry[] {
  if (authors.length === 0) {
    return entries;
  }
  const targets = new Set(authors.map((a) => a.toLowerCase()));
  return entries.filter((entry) => targets.has(entry.author.toLowerCase()));
}

/**
 * Filter entries by mine/reviews perspective.
 */
function filterByPerspective(
  entries: FirewatchEntry[],
  mine: boolean | undefined,
  reviews: boolean | undefined,
  username: string | undefined
): FirewatchEntry[] {
  if (!mine && !reviews) {
    return entries;
  }
  if (!username) {
    return entries;
  }
  return entries.filter((entry) =>
    mine ? entry.pr_author === username : entry.pr_author !== username
  );
}

/**
 * Normalize a PR filter value to an array.
 */
function normalizePrList(pr: number | number[] | undefined): number[] {
  if (pr === undefined) {
    return [];
  }
  if (Array.isArray(pr)) {
    return pr;
  }
  return [pr];
}

/**
 * Apply all client-side filters in sequence.
 */
function applyClientSideFilters(
  entries: FirewatchEntry[],
  input: QueryInput,
  username: string | undefined
): FirewatchEntry[] {
  let filtered = entries;
  filtered = filterByPrs(filtered, normalizePrList(input.pr));
  filtered = filterByTypes(filtered, input.type ?? []);
  filtered = filterByAuthors(filtered, input.author ?? []);
  filtered = filterByPerspective(
    filtered,
    input.mine,
    input.reviews,
    username
  );
  return filtered;
}

// =============================================================================
// Query Options Builder
// =============================================================================

/**
 * Resolve the effective since date from input.
 */
function resolveSinceDate(
  since: string | undefined,
  orphaned: boolean | undefined
): Result<Date | undefined, Error> {
  const sinceValue = since ?? (orphaned ? "7d" : undefined);
  if (!sinceValue) {
    const none: Date | undefined = undefined;
    return Result.ok(none);
  }
  const result = parseSince(sinceValue);
  if (result.isErr()) {
    return Result.err(result.error);
  }
  return Result.ok(result.value);
}

/**
 * Parse and validate a before date string.
 */
function resolveBeforeDate(
  before: string | undefined
): Result<Date | undefined, Error> {
  if (!before) {
    const none: Date | undefined = undefined;
    return Result.ok(none);
  }
  const date = new Date(before);
  if (Number.isNaN(date.getTime())) {
    return Result.err(
      new Error(
        `Invalid before date: ${before}. Use ISO format (e.g., 2024-01-15).`
      )
    );
  }
  return Result.ok(date);
}

/**
 * Resolve author exclusion filters from input.
 */
function resolveExcludeAuthors(
  excludeAuthor: string[] | undefined,
  noBots = false
): string[] | undefined {
  const excludeBots = noBots;
  const hasExclusions =
    (excludeAuthor && excludeAuthor.length > 0) || excludeBots;
  if (!hasExclusions) {
    return undefined;
  }
  return mergeExcludeAuthors(excludeAuthor ?? [], excludeBots);
}

/**
 * Build the filters object for queryEntries.
 */
function buildFilters(
  input: QueryInput,
  repoFilter: string | undefined,
  sinceDate: Date | undefined,
  beforeDate: Date | undefined
): QueryFilters {
  const excludeBots = input.noBots ?? false;
  const excludeAuthors = resolveExcludeAuthors(
    input.excludeAuthor,
    input.noBots
  );
  const includeStale = Boolean(input.stale || input.orphaned);

  return {
    ...(repoFilter && { repo: repoFilter }),
    ...(input.pr !== undefined && { pr: input.pr }),
    ...(input.type && input.type.length > 0 && { type: input.type }),
    ...(input.states && input.states.length > 0 && { states: input.states }),
    ...(input.label && { label: input.label }),
    ...(sinceDate && { since: sinceDate }),
    ...(beforeDate && { before: beforeDate }),
    ...(excludeAuthors && { excludeAuthors }),
    ...(excludeBots && { excludeBots: true }),
    ...(input.botPatterns &&
      input.botPatterns.length > 0 && { botPatterns: input.botPatterns }),
    ...(input.orphaned && { orphaned: true }),
    excludeStale: !includeStale,
    ...(input.includeFrozen && { includeFrozen: true }),
  };
}

/**
 * Build QueryOptions from handler input.
 * Translates the handler's typed input into the core queryEntries API.
 */
function buildQueryOptionsFromInput(
  input: QueryInput,
  repoFilter: string | undefined
): Result<QueryOptions, Error> {
  const sinceResult = resolveSinceDate(input.since, input.orphaned);
  if (sinceResult.isErr()) {
    return Result.err(sinceResult.error);
  }

  const beforeResult = resolveBeforeDate(input.before);
  if (beforeResult.isErr()) {
    return Result.err(beforeResult.error);
  }

  const options: QueryOptions = {
    filters: buildFilters(
      input,
      repoFilter,
      sinceResult.value,
      beforeResult.value
    ),
    ...(input.limit !== undefined && { limit: input.limit }),
    ...(input.offset !== undefined && { offset: input.offset }),
  };

  return Result.ok(options);
}

// =============================================================================
// Handler
// =============================================================================

/**
 * Query cached Firewatch entries.
 *
 * Builds query options from input, executes the query against the SQLite
 * database, applies client-side filters, and optionally aggregates results
 * into a per-PR worklist summary.
 *
 * Does NOT handle sync -- auto-sync is a transport concern (CLI shows spinner,
 * MCP has its own sync flow).
 *
 * @param input - Query input parameters
 * @param ctx - Handler context with config, db, and logger
 * @returns Result containing QueryOutput on success
 */
export async function queryHandler(
  input: QueryInput,
  ctx: HandlerContext
): Promise<Result<QueryOutput, Error>> {
  // Validate mutually exclusive options
  if (input.mine && input.reviews) {
    return Result.err(new Error("Cannot use mine and reviews together."));
  }

  // Build query options
  const repoFilter = input.repo;
  const optionsResult = buildQueryOptionsFromInput(input, repoFilter);
  if (optionsResult.isErr()) {
    return Result.err(optionsResult.error);
  }

  // Execute query
  const entries = await queryEntries(optionsResult.value);

  // Apply client-side filters
  const username = ctx.config.user?.github_username;
  const filtered = applyClientSideFilters(entries, input, username);
  const total = filtered.length;

  // Build worklist if summary requested
  if (input.summary) {
    const worklist = sortWorklist(buildWorklist(filtered));
    return Result.ok({ entries: filtered, worklist, total });
  }

  return Result.ok({ entries: filtered, total });
}
