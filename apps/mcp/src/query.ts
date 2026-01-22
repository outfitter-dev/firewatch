import {
  buildWorklist,
  parseSince,
  sortWorklist,
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
      ...(since && { since: parseSince(since) }),
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
