import {
  buildWorklist,
  parseSince,
  sortWorklist,
  type FirewatchConfig,
  type FirewatchEntry,
  type PrState,
  type QueryOptions,
} from "@outfitter/firewatch-core";

export interface QueryParams {
  repo?: string | undefined;
  pr?: number | undefined;
  author?: string | undefined;
  type?: FirewatchEntry["type"] | undefined;
  states?: PrState[] | undefined;
  label?: string | undefined;
  since?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  stack_id?: string | undefined;
  group_stack?: boolean | undefined;
  worklist?: boolean | undefined;
}

export interface QueryContext {
  repoFilter: string | undefined;
  states: PrState[] | undefined;
  since: string | undefined;
  detectedRepo: string | null;
}

export interface StackGroup {
  stack_id: string;
  entries: FirewatchEntry[];
}

export function resolveRepoFilter(
  repo: string | undefined,
  detectedRepo: string | null
): string | undefined {
  return repo ?? detectedRepo ?? undefined;
}

export function buildQueryContext(
  params: QueryParams,
  config: FirewatchConfig,
  detectedRepo: string | null
): QueryContext {
  const repoFilter = resolveRepoFilter(params.repo, detectedRepo);
  const states =
    params.states && params.states.length > 0
      ? params.states
      : (config.default_states ?? ["open", "draft"]);
  const since = params.since ?? config.default_since;

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
  const wantsGraphite = Boolean(
    params.stack_id || params.group_stack || params.worklist
  );
  return Boolean(
    wantsGraphite &&
      context.detectedRepo &&
      context.repoFilter === context.detectedRepo
  );
}

export function filterByStackId(
  entries: FirewatchEntry[],
  stackId: string | undefined
): FirewatchEntry[] {
  if (!stackId) {
    return entries;
  }
  return entries.filter((entry) => entry.graphite?.stack_id === stackId);
}

export function groupByStack(entries: FirewatchEntry[]): StackGroup[] {
  const groups = new Map<string, FirewatchEntry[]>();
  for (const entry of entries) {
    const stackId = entry.graphite?.stack_id;
    if (!stackId) {
      continue;
    }
    const group = groups.get(stackId) ?? [];
    group.push(entry);
    groups.set(stackId, group);
  }

  return [...groups.entries()].map(([stack_id, groupedEntries]) => ({
    stack_id,
    entries: groupedEntries,
  }));
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
): Promise<FirewatchEntry[] | ReturnType<typeof buildWorklist> | StackGroup[]> {
  let output = entries;

  if (shouldEnrichGraphite(params, context)) {
    output = await helpers.enrichGraphite(entries);
  }

  output = filterByStackId(output, params.stack_id);

  if (params.worklist) {
    return buildWorklistOutput(output);
  }

  if (params.group_stack) {
    return groupByStack(output);
  }

  return output;
}
