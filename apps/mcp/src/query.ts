import {
  buildWorklist,
  mergeExcludeAuthors,
  parseSince,
  sortWorklist,
  type FirewatchConfig,
  type FirewatchEntry,
  type PrState,
  type QueryOptions,
} from "@outfitter/firewatch-core";

export interface QueryParams {
  repo?: string | undefined;
  pr?: number | number[] | undefined;
  author?: string | undefined;
  type?: FirewatchEntry["type"] | FirewatchEntry["type"][] | undefined;
  states?: PrState[] | undefined;
  label?: string | undefined;
  since?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  summary?: boolean | undefined;
}

// ============================================================================
// Extended params for MCP handleQuery (includes all options)
// ============================================================================

export interface McpQueryParams extends QueryParams {
  all?: boolean | undefined;
  mine?: boolean | undefined;
  reviews?: boolean | undefined;
  no_bots?: boolean | undefined;
  no_sync?: boolean | undefined;
  sync_full?: boolean | undefined;
  orphaned?: boolean | undefined;
  open?: boolean | undefined;
  ready?: boolean | undefined;
  draft?: boolean | undefined;
  stale?: boolean | undefined;
  summary_short?: boolean | undefined;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate mutually exclusive query options.
 * Throws with user-friendly error message if validation fails.
 */
export function validateMcpQueryOptions(params: McpQueryParams): void {
  if (params.mine && params.reviews) {
    throw new Error("Cannot use mine and reviews together.");
  }

  if (params.orphaned && (params.open || params.ready || params.draft)) {
    throw new Error(
      "Cannot use orphaned with open/ready/draft (orphaned implies merged/closed PRs)."
    );
  }

  if (params.sync_full && params.no_sync) {
    throw new Error("Cannot sync while no_sync is true.");
  }
}

// ============================================================================
// PR Filter Construction
// ============================================================================

/**
 * Build PR filter value from number array.
 * Returns single number for single item, array for multiple, undefined for empty.
 */
export function buildPrFilter(prList: number[]): number | number[] | undefined {
  if (prList.length > 1) {
    return prList;
  }
  if (prList.length === 1) {
    return prList[0];
  }
  return undefined;
}

// ============================================================================
// Bot Filter Resolution
// ============================================================================

export interface BotFilterResult {
  excludeAuthors: string[] | undefined;
  excludeBots: boolean;
  botPatterns: RegExp[];
}

/**
 * Resolve bot filtering options from params and config.
 */
export function resolveBotFilters(
  params: McpQueryParams,
  config: FirewatchConfig,
  cliExcludeAuthors: string[]
): BotFilterResult {
  const excludeBots = params.no_bots ?? config.filters?.exclude_bots ?? false;
  const configExclusions = config.filters?.exclude_authors ?? [];

  const botPatterns = (config.filters?.bot_patterns ?? [])
    .map((pattern) => {
      try {
        return new RegExp(pattern, "i");
      } catch {
        return null;
      }
    })
    .filter((pattern): pattern is RegExp => pattern !== null);

  const excludeAuthorsMerged =
    cliExcludeAuthors.length > 0 || configExclusions.length > 0 || excludeBots
      ? mergeExcludeAuthors(
          [...configExclusions, ...cliExcludeAuthors],
          excludeBots
        )
      : undefined;

  return {
    excludeAuthors: excludeAuthorsMerged,
    excludeBots,
    botPatterns,
  };
}

// ============================================================================
// Summary Flag Resolution
// ============================================================================

export interface SummaryFlags {
  wantsSummary: boolean;
  wantsSummaryShort: boolean;
}

/**
 * Resolve summary output flags from params.
 */
export function resolveSummaryFlags(params: McpQueryParams): SummaryFlags {
  const wantsSummaryShort = Boolean(params.summary_short);
  const wantsSummary = Boolean(params.summary || wantsSummaryShort);

  return { wantsSummary, wantsSummaryShort };
}

// ============================================================================
// Mine/Reviews Filtering
// ============================================================================

/**
 * Filter entries by mine/reviews perspective.
 */
export function filterByPerspective(
  entries: FirewatchEntry[],
  params: McpQueryParams,
  username: string | undefined
): FirewatchEntry[] {
  if (!params.mine && !params.reviews) {
    return entries;
  }

  if (!username) {
    throw new Error(
      "user.github_username must be set for mine/reviews filters."
    );
  }

  return entries.filter((entry) =>
    params.mine ? entry.pr_author === username : entry.pr_author !== username
  );
}

export interface QueryContext {
  repoFilter: string | undefined;
  states: PrState[] | undefined;
  since: string | undefined;
  detectedRepo: string | null;
}

export function resolveRepoFilter(
  repo: string | undefined,
  detectedRepo: string | null
): string | undefined {
  return repo ?? detectedRepo ?? undefined;
}

export function buildQueryContext(
  params: QueryParams,
  detectedRepo: string | null
): QueryContext {
  const repoFilter = resolveRepoFilter(params.repo, detectedRepo);
  const states =
    params.states && params.states.length > 0 ? params.states : undefined;
  const since = params.since;

  return {
    repoFilter,
    states,
    since,
    detectedRepo,
  };
}

export function buildQueryOptions(
  params: QueryParams,
  context: QueryContext
): QueryOptions {
  const { repoFilter, states, since } = context;

  return {
    filters: {
      ...(repoFilter && { repo: repoFilter }),
      ...(params.pr !== undefined && { pr: params.pr }),
      ...(params.author && { author: params.author }),
      ...(params.type && { type: params.type }),
      ...(states && { states }),
      ...(params.label && { label: params.label }),
      ...(since && {
        since: (() => {
          const result = parseSince(since);
          if (result.isErr()) {
            throw new Error(result.error.message);
          }
          return result.value;
        })(),
      }),
    },
    ...(params.limit !== undefined && { limit: params.limit }),
    ...(params.offset !== undefined && { offset: params.offset }),
  };
}

export function shouldEnrichGraphite(
  params: QueryParams,
  context: QueryContext
): boolean {
  const wantsGraphite = Boolean(params.summary);
  return Boolean(
    wantsGraphite &&
    context.detectedRepo &&
    context.repoFilter === context.detectedRepo
  );
}

export function buildWorklistOutput(entries: FirewatchEntry[]) {
  return sortWorklist(buildWorklist(entries));
}

export async function resolveQueryOutput(
  params: QueryParams,
  entries: FirewatchEntry[],
  context: QueryContext,
  helpers: {
    enrichGraphite: (entries: FirewatchEntry[]) => Promise<FirewatchEntry[]>;
  }
): Promise<FirewatchEntry[] | ReturnType<typeof buildWorklist>> {
  let output = entries;

  if (shouldEnrichGraphite(params, context)) {
    output = await helpers.enrichGraphite(entries);
  }

  if (params.summary) {
    return buildWorklistOutput(output);
  }

  return output;
}

// ============================================================================
// Client-side Filtering
// ============================================================================

/**
 * Filter entries by PR numbers.
 */
export function filterByPrs(
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
 * Filter entries by entry types.
 */
export function filterByTypes(
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
 * Filter entries by author include list.
 */
export function filterByAuthors(
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
 * Apply all client-side filters in sequence.
 */
export function applyClientSideFilters(
  entries: FirewatchEntry[],
  prList: number[],
  typeList: FirewatchEntry["type"][],
  includeAuthors: string[]
): FirewatchEntry[] {
  let filtered = entries;
  filtered = filterByPrs(filtered, prList);
  filtered = filterByTypes(filtered, typeList);
  filtered = filterByAuthors(filtered, includeAuthors);
  return filtered;
}
