import {
  detectRepo,
  loadConfig,
  queryEntries,
  type FirewatchEntry,
  type WorklistEntry,
} from "@outfitter/firewatch-core";

import { ensureRepoCacheIfNeeded } from "../context/repo";
import {
  applyClientSideFilters,
  buildPrFilter,
  buildQueryContext,
  buildQueryOptions,
  filterByPerspective,
  resolveBotFilters,
  resolveQueryOutput,
  resolveSummaryFlags,
  validateMcpQueryOptions,
  type McpQueryParams,
} from "../query";
import type { FirewatchParams, McpToolResult } from "../types";
import { jsonLines, textResult } from "../utils/formatting";
import {
  formatStatusShort,
  resolveAuthorLists,
  resolveLabelFilter,
  resolveStates,
  resolveSyncScopes,
  resolveTypeList,
  toNumberList,
} from "../utils/parsing";
import {
  addShortIds,
  enrichGraphite,
  performSync,
  resolveSyncRepos,
} from "../utils/sync";

async function handleQuerySyncFull(
  params: McpQueryParams,
  config: Awaited<ReturnType<typeof loadConfig>>,
  detectedRepo: string | null,
  states: ReturnType<typeof resolveStates>
): Promise<void> {
  if (!params.sync_full) {
    return;
  }

  const repos = resolveSyncRepos(params, config, detectedRepo);
  if (repos.length === 0) {
    throw new Error("No repository detected. Provide repo or configure repos.");
  }

  await performSync(repos, config, detectedRepo, {
    full: true,
    scopes: resolveSyncScopes(states),
  });
}

function formatQueryOutput(
  output: unknown[],
  wantsSummary: boolean,
  wantsSummaryShort: boolean
): McpToolResult {
  if (wantsSummaryShort) {
    if (!Array.isArray(output)) {
      throw new TypeError("summary_short requires summary output.");
    }
    return textResult(jsonLines(formatStatusShort(output as WorklistEntry[])));
  }

  if (!wantsSummary && Array.isArray(output)) {
    return textResult(jsonLines(addShortIds(output as FirewatchEntry[])));
  }

  return textResult(jsonLines(output));
}

export async function handleQuery(
  params: FirewatchParams
): Promise<McpToolResult> {
  const mcpParams = params as McpQueryParams;

  // Phase 1: Validate options
  validateMcpQueryOptions(mcpParams);

  // Phase 2: Load config and detect repo
  const config = await loadConfig();
  const detected = await detectRepo();
  const detectedRepo = params.all ? null : detected.repo;

  // Phase 3: Parse input values
  const states = resolveStates(params);
  const labelFilter = resolveLabelFilter(params.label);
  const typeList = resolveTypeList(params.type);
  const prList = toNumberList(params.pr);
  const { include: includeAuthors, exclude: excludeAuthors } =
    resolveAuthorLists(params.author);
  const { wantsSummary, wantsSummaryShort } = resolveSummaryFlags(mcpParams);

  // Phase 4: Handle sync if requested
  await handleQuerySyncFull(mcpParams, config, detected.repo, states);

  // Phase 5: Build query parameters
  const prFilter = buildPrFilter(prList);
  const queryParams = {
    repo: params.all ? undefined : params.repo,
    ...(prFilter !== undefined && { pr: prFilter }),
    type: typeList.length > 0 ? typeList : undefined,
    states,
    label: labelFilter,
    since: params.since ?? (params.orphaned ? "7d" : undefined),
    limit: params.limit,
    offset: params.offset,
    summary: wantsSummary,
  };

  const context = buildQueryContext(queryParams, detectedRepo);

  // Phase 6: Ensure cache is populated
  const cacheOptions = params.no_sync ? { noSync: true } : {};
  await ensureRepoCacheIfNeeded(
    context.repoFilter,
    config,
    detected.repo,
    states,
    cacheOptions
  );

  // Phase 7: Resolve bot filters
  const botFilters = resolveBotFilters(mcpParams, config, excludeAuthors);

  // Phase 8: Execute query
  const queryOptions = buildQueryOptions(queryParams, context);
  const entries = await queryEntries({
    ...queryOptions,
    filters: {
      ...queryOptions.filters,
      ...(botFilters.excludeAuthors && {
        excludeAuthors: botFilters.excludeAuthors,
      }),
      ...(botFilters.excludeBots && { excludeBots: true }),
      ...(botFilters.botPatterns.length > 0 && {
        botPatterns: botFilters.botPatterns,
      }),
      excludeStale: !(params.stale || params.orphaned),
      ...(params.orphaned && { orphaned: true }),
    },
  });

  // Phase 9: Apply client-side filters
  let filtered = applyClientSideFilters(
    entries,
    prList,
    typeList,
    includeAuthors
  );
  filtered = filterByPerspective(
    filtered,
    mcpParams,
    config.user?.github_username
  );

  // Phase 10: Resolve and format output
  const output = await resolveQueryOutput(queryParams, filtered, context, {
    enrichGraphite,
  });

  return formatQueryOutput(output, wantsSummary, wantsSummaryShort);
}
