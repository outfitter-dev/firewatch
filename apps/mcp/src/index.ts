import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  DEFAULT_BOT_PATTERNS,
  DEFAULT_EXCLUDE_AUTHORS,
  GitHubClient,
  PATHS,
  addAck,
  addAcks,
  batchAddReactions,
  buildShortIdCache,
  classifyId,
  countEntries,
  detectAuth,
  detectRepo,
  ensureDirectories,
  formatShortId,
  generateShortId,
  getAckedIds,
  getAllSyncMeta,
  getConfigPaths,
  getDatabase,
  getProjectConfigPath,
  getRepos,
  getSyncMeta,
  isCommentEntry,
  isReviewComment,
  isShortId,
  loadConfig,
  parseDurationMs,
  parseSince,
  queryEntries,
  resolveBatchIds,
  resolveShortId,
  shouldExcludeAuthor,
  syncRepo,
  type AckRecord,
  type AuthResult,
  type FirewatchConfig,
  type FirewatchEntry,
  type PrState,
  type WorklistEntry,
} from "@outfitter/firewatch-core";
import {
  getGraphiteStacks,
  graphitePlugin,
} from "@outfitter/firewatch-core/plugins";
import {
  CONFIG_SCHEMA_DOC,
  ENTRY_SCHEMA_DOC,
  WORKLIST_SCHEMA_DOC,
} from "@outfitter/firewatch-core/schema";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";

import { version as mcpVersion } from "../package.json";
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
} from "./query";
import {
  type DoctorParams,
  DoctorParamsShape,
  type FeedbackParams,
  FeedbackParamsShape,
  type HelpParams,
  HelpParamsShape,
  type PrParams,
  PrParamsShape,
  type QueryParams,
  QueryParamsShape,
  type StatusParams,
  StatusParamsShape,
  TOOL_DESCRIPTIONS,
} from "./schemas";

type SchemaName = "query" | "entry" | "worklist" | "config";

// Legacy type for internal handler compatibility
// Using `| undefined` explicitly for exactOptionalPropertyTypes compatibility
interface FirewatchParams {
  action?: string | undefined;
  repo?: string | undefined;
  pr?: number | number[] | string | undefined;
  type?:
    | "comment"
    | "review"
    | "commit"
    | "ci"
    | "event"
    | ("comment" | "review" | "commit" | "ci" | "event")[]
    | string
    | undefined;
  author?: string | string[] | undefined;
  states?: ("open" | "closed" | "merged" | "draft")[] | undefined;
  state?: string | string[] | undefined;
  open?: boolean | undefined;
  ready?: boolean | undefined;
  closed?: boolean | undefined;
  draft?: boolean | undefined;
  label?: string | undefined;
  since?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  summary?: boolean | undefined;
  summary_short?: boolean | undefined;
  orphaned?: boolean | undefined;
  status_short?: boolean | undefined;
  short?: boolean | undefined;
  all?: boolean | undefined;
  mine?: boolean | undefined;
  reviews?: boolean | undefined;
  no_bots?: boolean | undefined;
  no_sync?: boolean | undefined;
  sync_full?: boolean | undefined;
  body?: string | undefined;
  reply_to?: string | undefined;
  resolve?: boolean | undefined;
  comment_ids?: string[] | undefined;
  comment_id?: string | undefined;
  review?: "approve" | "request-changes" | "comment" | undefined;
  reviewer?: string | string[] | undefined;
  assignee?: string | string[] | undefined;
  labels?: string | string[] | undefined;
  title?: string | undefined;
  base?: string | undefined;
  milestone?: string | boolean | undefined;
  local?: boolean | undefined;
  path?: boolean | undefined;
  key?: string | undefined;
  value?: string | undefined;
  fix?: boolean | undefined;
  schema?: "query" | "entry" | "worklist" | "config" | undefined;
}

interface McpToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
}

function textResult(text: string): McpToolResult {
  return {
    content: [{ type: "text", text }],
  };
}

function jsonLines(items: unknown[]): string {
  if (items.length === 0) {
    return "";
  }
  return items.map((item) => JSON.stringify(item)).join("\n");
}

/** Check if params contain any PR edit fields (title, body, base, draft, ready, milestone) */
function hasEditFields(
  params: PrParams | FirewatchParams
): boolean {
  return !!(
    params.title ||
    params.body ||
    params.base ||
    params.draft ||
    params.ready ||
    params.milestone
  );
}

const ENTRY_TYPES = ["comment", "review", "commit", "ci", "event"] as const;
const ENTRY_TYPE_SET = new Set<string>(ENTRY_TYPES);
const PR_STATES = ["open", "closed", "merged", "draft"] as const;
const PR_STATE_SET = new Set<string>(PR_STATES);
const DEFAULT_STALE_THRESHOLD = "5m";

function toStringList(value?: string | string[]): string[] {
  if (!value) {
    return [];
  }

  const items = Array.isArray(value) ? value : [value];
  return items
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

function toNumberList(value?: number | number[] | string): number[] {
  if (value === undefined) {
    return [];
  }

  const items = Array.isArray(value) ? value : [value];
  const results: number[] = [];

  for (const item of items) {
    if (typeof item === "number") {
      results.push(item);
      continue;
    }

    if (typeof item === "string") {
      const parts = item
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      for (const part of parts) {
        const parsed = Number.parseInt(part, 10);
        if (Number.isNaN(parsed)) {
          throw new TypeError(`Invalid PR number: ${part}`);
        }
        results.push(parsed);
      }
    }
  }

  return results;
}

function requirePrNumber(value: FirewatchParams["pr"], action: string): number {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
    throw new Error(`${action} requires pr.`);
  }
  return value;
}

function resolveStates(params: FirewatchParams): PrState[] {
  if (params.states && params.states.length > 0) {
    return params.states;
  }

  const explicit = toStringList(params.state);
  if (explicit.length > 0) {
    const resolved: PrState[] = [];
    for (const value of explicit) {
      const normalized = value.toLowerCase();
      if (!PR_STATE_SET.has(normalized)) {
        throw new Error(`Invalid state: ${value}`);
      }
      if (!resolved.includes(normalized as PrState)) {
        resolved.push(normalized as PrState);
      }
    }
    return resolved;
  }

  const combined: PrState[] = [];
  if (params.open) {
    combined.push("open", "draft");
  }
  if (params.ready) {
    combined.push("open");
    if (!params.draft) {
      const draftIndex = combined.indexOf("draft");
      if (draftIndex >= 0) {
        combined.splice(draftIndex, 1);
      }
    }
  }
  if (params.closed) {
    combined.push("closed", "merged");
  }
  if (params.draft) {
    combined.push("draft");
  }

  if (combined.length > 0) {
    return [...new Set(combined)];
  }

  // Orphaned implies merged/closed PRs (unresolved comments on finished PRs)
  if (params.orphaned) {
    return ["closed", "merged"];
  }

  return ["open", "draft"];
}

function resolveTypeList(
  value: FirewatchParams["type"]
): FirewatchEntry["type"][] {
  const types = toStringList(value as string | string[]);
  if (types.length === 0) {
    return [];
  }

  const resolved: FirewatchEntry["type"][] = [];
  for (const type of types) {
    const normalized = type.toLowerCase();
    if (!ENTRY_TYPE_SET.has(normalized)) {
      throw new Error(`Invalid type: ${type}`);
    }
    if (!resolved.includes(normalized as FirewatchEntry["type"])) {
      resolved.push(normalized as FirewatchEntry["type"]);
    }
  }

  return resolved;
}

function resolveLabelFilter(
  value: FirewatchParams["label"]
): string | undefined {
  if (!value) {
    return undefined;
  }

  const labels = toStringList(value);
  if (labels.length > 1) {
    throw new Error("Label filter supports a single value.");
  }

  return labels[0];
}

function resolveAuthorLists(value: FirewatchParams["author"]): {
  include: string[];
  exclude: string[];
} {
  const authors = toStringList(value);
  const include: string[] = [];
  const exclude: string[] = [];

  for (const author of authors) {
    if (author.startsWith("!")) {
      const trimmed = author.slice(1).trim();
      if (trimmed) {
        exclude.push(trimmed);
      }
    } else if (author) {
      include.push(author);
    }
  }

  return { include, exclude };
}

function formatStatusShort(items: WorklistEntry[]) {
  return items.map((item) => ({
    repo: item.repo,
    pr: item.pr,
    pr_title: item.pr_title,
    pr_state: item.pr_state,
    pr_author: item.pr_author,
    last_activity_at: item.last_activity_at,
    comments: item.counts.comments,
    changes_requested: item.review_states?.changes_requested ?? 0,
    ...(item.graphite?.stack_id && {
      stack_id: item.graphite.stack_id,
      stack_position: item.graphite.stack_position,
    }),
  }));
}

function isFullRepo(value: string): boolean {
  return /^[^/]+\/[^/]+$/.test(value);
}

function hasRepoCache(repo: string): boolean {
  const db = getDatabase();
  const meta = getSyncMeta(db, repo);
  return meta !== null && countEntries(db, { exactRepo: repo }) > 0;
}

async function resolveRepo(repo?: string): Promise<string | null> {
  if (repo) {
    return repo;
  }

  const detected = await detectRepo();
  if (detected.repo) {
    return detected.repo;
  }

  return null;
}

/**
 * Resolve a short ID to a full GitHub comment ID.
 * Accepts short IDs with or without `@` prefix.
 * Returns the original ID if it's not a short ID or if resolution fails.
 */
async function resolveCommentIdFromShortId(
  id: string,
  repo?: string
): Promise<string> {
  if (!isShortId(id)) {
    return id;
  }

  // First try the in-memory cache
  const cached = resolveShortId(id);
  if (cached) {
    return cached.fullId;
  }

  // If not in cache, use batch resolution (queries, builds cache, resolves)
  const repoFilter = repo ?? (await resolveRepo());
  if (!repoFilter) {
    throw new Error("Cannot resolve short ID without repo context.");
  }

  const [resolution] = await resolveBatchIds([id], repoFilter);

  if (resolution?.type === "comment" && resolution.entry) {
    return resolution.entry.id;
  }

  throw new Error(
    `Short ID ${formatShortId(id)} not found in cache. Run fw_query or fw_fb first.`
  );
}

async function ensureRepoCache(
  repo: string,
  config: FirewatchConfig,
  detectedRepo: string | null
): Promise<void> {
  if (hasRepoCache(repo)) {
    return;
  }

  await ensureDirectories();

  const auth = await detectAuth(config.github_token);
  if (!auth.token) {
    throw new Error(auth.error);
  }

  const graphiteEnabled =
    detectedRepo === repo && (await getGraphiteStacks()) !== null;
  const plugins = graphiteEnabled ? [graphitePlugin] : [];
  const client = new GitHubClient(auth.token);
  await syncRepo(client, repo, { plugins });
}

async function ensureRepoCacheIfNeeded(
  repoFilter: string | undefined,
  config: FirewatchConfig,
  detectedRepo: string | null,
  options: { noSync?: boolean } = {}
): Promise<void> {
  if (!repoFilter || !isFullRepo(repoFilter)) {
    return;
  }

  const hasCached = hasRepoCache(repoFilter);

  if (options.noSync) {
    if (!hasCached) {
      throw new Error(`No-sync mode: no cache for ${repoFilter}.`);
    }
    return;
  }

  if (!hasCached) {
    await ensureRepoCache(repoFilter, config, detectedRepo);
    return;
  }

  const autoSync = config.sync?.auto_sync ?? true;
  if (!autoSync) {
    return;
  }

  const threshold = config.sync?.stale_threshold ?? DEFAULT_STALE_THRESHOLD;
  let thresholdMs = 0;
  try {
    thresholdMs = parseDurationMs(threshold);
  } catch {
    thresholdMs = parseDurationMs(DEFAULT_STALE_THRESHOLD);
  }

  const db = getDatabase();
  const repoMeta = getSyncMeta(db, repoFilter);
  const lastSync = repoMeta?.last_sync;
  if (!lastSync) {
    await ensureRepoCache(repoFilter, config, detectedRepo);
    return;
  }

  const ageMs = Date.now() - new Date(lastSync).getTime();
  if (ageMs > thresholdMs) {
    await ensureRepoCache(repoFilter, config, detectedRepo);
  }
}

async function enrichGraphite(
  entries: FirewatchEntry[]
): Promise<FirewatchEntry[]> {
  const stacks = await getGraphiteStacks();
  if (!stacks) {
    return entries;
  }

  if (!graphitePlugin.enrich) {
    return entries;
  }

  return Promise.all(entries.map((entry) => graphitePlugin.enrich!(entry)));
}

async function resolveGraphiteEnabled(
  detectedRepo: string | null
): Promise<boolean> {
  if (!detectedRepo) {
    return false;
  }

  return (await getGraphiteStacks()) !== null;
}

function resolveSyncRepos(
  params: FirewatchParams,
  config: FirewatchConfig,
  detectedRepo: string | null
): string[] {
  const repos: string[] = [];
  if (params.repo) {
    repos.push(params.repo);
  } else if (config.repos.length > 0) {
    repos.push(...config.repos);
  } else if (detectedRepo) {
    repos.push(detectedRepo);
  }

  return repos;
}

async function performSync(
  repos: string[],
  config: FirewatchConfig,
  detectedRepo: string | null,
  options: { full?: boolean; since?: string } = {}
): Promise<
  {
    repo: string;
    prs_processed: number;
    entries_added: number;
  }[]
> {
  const auth = await detectAuth(config.github_token);
  if (!auth.token) {
    throw new Error(auth.error);
  }

  const client = new GitHubClient(auth.token);
  const graphiteEnabled = await resolveGraphiteEnabled(detectedRepo);

  const results: {
    repo: string;
    prs_processed: number;
    entries_added: number;
  }[] = [];

  for (const repo of repos) {
    const useGraphite = graphiteEnabled && repo === detectedRepo;
    const result = await syncRepo(client, repo, {
      ...(options.full && { full: true }),
      ...(options.since && { since: parseSince(options.since) }),
      plugins: useGraphite ? [graphitePlugin] : [],
    });

    results.push({
      repo,
      prs_processed: result.prsProcessed,
      entries_added: result.entriesAdded,
    });
  }

  return results;
}


function addShortIds(entries: FirewatchEntry[]): FirewatchEntry[] {
  // Build cache first so short IDs can be resolved in follow-up commands
  buildShortIdCache(entries);

  return entries.map((entry) => {
    if (entry.type !== "comment") {
      return entry;
    }
    return {
      ...entry,
      short_id: formatShortId(generateShortId(entry.id, entry.repo)),
    };
  });
}

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

async function handleQuerySyncFull(
  params: McpQueryParams,
  config: FirewatchConfig,
  detectedRepo: string | null
): Promise<void> {
  if (!params.sync_full) {
    return;
  }

  const repos = resolveSyncRepos(params, config, detectedRepo);
  if (repos.length === 0) {
    throw new Error("No repository detected. Provide repo or configure repos.");
  }

  await performSync(repos, config, detectedRepo, { full: true });
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

async function handleQuery(params: FirewatchParams): Promise<McpToolResult> {
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
  await handleQuerySyncFull(mcpParams, config, detected.repo);

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
  filtered = filterByPerspective(filtered, mcpParams, config.user?.github_username);

  // Phase 10: Resolve and format output
  const output = await resolveQueryOutput(queryParams, filtered, context, {
    enrichGraphite,
  });

  return formatQueryOutput(output, wantsSummary, wantsSummaryShort);
}

async function handleStatus(params: FirewatchParams): Promise<McpToolResult> {
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
      ok: Boolean(auth.token),
      source: auth.source,
      ...(auth.error && { error: auth.error }),
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

// ─────────────────────────────────────────────────────────────────────────────
// Add/Edit/Rm handler helpers
// ─────────────────────────────────────────────────────────────────────────────

interface MutationContext {
  repo: string;
  owner: string;
  name: string;
  client: GitHubClient;
}

async function createMutationContext(
  repoParam: string | undefined
): Promise<MutationContext> {
  const repo = (await resolveRepo(repoParam)) ?? null;
  if (!repo) {
    throw new Error("No repository detected. Provide repo.");
  }

  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid repo format: ${repo}. Expected owner/repo.`);
  }

  const config = await loadConfig();
  const auth = await detectAuth(config.github_token);
  if (!auth.token) {
    throw new Error(auth.error);
  }

  return { repo, owner, name, client: new GitHubClient(auth.token) };
}

async function handleAddReview(
  ctx: MutationContext,
  pr: number,
  reviewType: "approve" | "request-changes" | "comment",
  body?: string
): Promise<McpToolResult> {
  const review = await ctx.client.addReview(
    ctx.owner,
    ctx.name,
    pr,
    reviewType,
    body
  );
  return textResult(
    JSON.stringify({
      ok: true,
      repo: ctx.repo,
      pr,
      review: reviewType,
      ...(review?.id && { review_id: review.id }),
      ...(review?.url && { url: review.url }),
    })
  );
}

async function handleAddMetadata(
  ctx: MutationContext,
  pr: number,
  labels: string[],
  reviewers: string[],
  assignees: string[]
): Promise<McpToolResult> {
  if (labels.length > 0) {
    await ctx.client.addLabels(ctx.owner, ctx.name, pr, labels);
  }
  if (reviewers.length > 0) {
    await ctx.client.requestReviewers(ctx.owner, ctx.name, pr, reviewers);
  }
  if (assignees.length > 0) {
    await ctx.client.addAssignees(ctx.owner, ctx.name, pr, assignees);
  }

  return textResult(
    JSON.stringify({
      ok: true,
      repo: ctx.repo,
      pr,
      ...(labels.length > 0 && { labels_added: labels }),
      ...(reviewers.length > 0 && { reviewers_added: reviewers }),
      ...(assignees.length > 0 && { assignees_added: assignees }),
    })
  );
}

async function handleAddReply(
  ctx: MutationContext,
  pr: number,
  replyTo: string,
  body: string,
  shouldResolve: boolean
): Promise<McpToolResult> {
  const replyToId = await resolveCommentIdFromShortId(replyTo, ctx.repo);
  const threadMap = await ctx.client.fetchReviewThreadMap(
    ctx.owner,
    ctx.name,
    pr
  );
  const threadId = threadMap.get(replyToId);
  if (!threadId) {
    throw new Error(`No review thread found for comment ${replyTo}.`);
  }

  const reply = await ctx.client.addReviewThreadReply(threadId, body);
  if (shouldResolve) {
    await ctx.client.resolveReviewThread(threadId);
  }

  return textResult(
    JSON.stringify({
      ok: true,
      repo: ctx.repo,
      pr,
      comment_id: reply.id,
      reply_to: replyToId,
      ...(shouldResolve && { resolved: true }),
      ...(reply.url && { url: reply.url }),
    })
  );
}

async function handleAddComment(
  ctx: MutationContext,
  pr: number,
  body: string
): Promise<McpToolResult> {
  const prId = await ctx.client.fetchPullRequestId(ctx.owner, ctx.name, pr);
  const comment = await ctx.client.addIssueComment(prId, body);

  return textResult(
    JSON.stringify({
      ok: true,
      repo: ctx.repo,
      pr,
      comment_id: comment.id,
      ...(comment.url && { url: comment.url }),
    })
  );
}

async function handleAdd(params: FirewatchParams): Promise<McpToolResult> {
  if (params.resolve && !params.reply_to) {
    throw new Error("resolve requires reply_to.");
  }

  const pr = requirePrNumber(params.pr, "add");
  const ctx = await createMutationContext(params.repo);

  const labels = toStringList(params.labels ?? params.label);
  const reviewers = toStringList(params.reviewer);
  const assignees = toStringList(params.assignee);
  const hasMetadata =
    labels.length > 0 || reviewers.length > 0 || assignees.length > 0;
  const hasReview = Boolean(params.review);

  if (hasReview && hasMetadata) {
    throw new Error(
      "Review actions cannot be combined with label/reviewer/assignee updates."
    );
  }

  if (!hasReview && !hasMetadata && !params.body) {
    throw new Error("add requires body.");
  }

  if (hasMetadata && params.body) {
    throw new Error("Remove body when adding labels/reviewers/assignees.");
  }

  if (hasReview) {
    return handleAddReview(ctx, pr, params.review!, params.body);
  }

  if (hasMetadata) {
    return handleAddMetadata(ctx, pr, labels, reviewers, assignees);
  }

  const body = params.body ?? "";

  if (params.reply_to) {
    return handleAddReply(ctx, pr, params.reply_to, body, Boolean(params.resolve));
  }

  return handleAddComment(ctx, pr, body);
}

async function applyPrFieldEdits(
  ctx: MutationContext,
  pr: number,
  params: { title?: string; body?: string; base?: string }
): Promise<void> {
  if (params.title || params.body || params.base) {
    await ctx.client.editPullRequest(ctx.owner, ctx.name, pr, {
      ...(params.title && { title: params.title }),
      ...(params.body && { body: params.body }),
      ...(params.base && { base: params.base }),
    });
  }
}

async function applyDraftStatus(
  ctx: MutationContext,
  pr: number,
  draft: boolean | undefined,
  ready: boolean | undefined
): Promise<void> {
  if (!draft && !ready) {
    return;
  }

  const prId = await ctx.client.fetchPullRequestId(ctx.owner, ctx.name, pr);
  if (draft) {
    await ctx.client.convertPullRequestToDraft(prId);
  }
  if (ready) {
    await ctx.client.markPullRequestReady(prId);
  }
}

async function handleEdit(params: FirewatchParams): Promise<McpToolResult> {
  if (params.draft && params.ready) {
    throw new Error("edit cannot use draft and ready together.");
  }

  const pr = requirePrNumber(params.pr, "edit");

  const milestoneName =
    typeof params.milestone === "string" ? params.milestone : undefined;
  if (params.milestone && !milestoneName) {
    throw new Error("edit milestone requires a string name.");
  }

  if (!hasEditFields(params)) {
    throw new Error("edit requires at least one field.");
  }

  const ctx = await createMutationContext(params.repo);

  await applyPrFieldEdits(ctx, pr, {
    ...(params.title !== undefined && { title: params.title }),
    ...(params.body !== undefined && { body: params.body }),
    ...(params.base !== undefined && { base: params.base }),
  });

  if (milestoneName) {
    await ctx.client.setMilestone(ctx.owner, ctx.name, pr, milestoneName);
  }

  await applyDraftStatus(ctx, pr, params.draft, params.ready);

  return textResult(
    JSON.stringify({
      ok: true,
      repo: ctx.repo,
      pr,
      ...(params.title && { title: params.title }),
      ...(params.body && { body: params.body }),
      ...(params.base && { base: params.base }),
      ...(milestoneName && { milestone: milestoneName }),
      ...(params.draft && { draft: true }),
      ...(params.ready && { ready: true }),
    })
  );
}

async function handleRm(params: FirewatchParams): Promise<McpToolResult> {
  const labels = toStringList(params.labels ?? params.label);
  const reviewers = toStringList(params.reviewer);
  const assignees = toStringList(params.assignee);
  const clearMilestone =
    params.milestone === true || typeof params.milestone === "string";
  const hasWork =
    labels.length > 0 ||
    reviewers.length > 0 ||
    assignees.length > 0 ||
    clearMilestone;

  if (!hasWork) {
    throw new Error("rm requires label, reviewer, assignee, or milestone.");
  }

  const pr = requirePrNumber(params.pr, "rm");

  const repo = (await resolveRepo(params.repo)) ?? null;
  if (!repo) {
    throw new Error("No repository detected. Provide repo.");
  }

  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid repo format: ${repo}. Expected owner/repo.`);
  }

  const config = await loadConfig();
  const auth = await detectAuth(config.github_token);
  if (!auth.token) {
    throw new Error(auth.error);
  }

  const client = new GitHubClient(auth.token);

  if (labels.length > 0) {
    await client.removeLabels(owner, name, pr, labels);
  }
  if (reviewers.length > 0) {
    await client.removeReviewers(owner, name, pr, reviewers);
  }
  if (assignees.length > 0) {
    await client.removeAssignees(owner, name, pr, assignees);
  }
  if (clearMilestone) {
    await client.clearMilestone(owner, name, pr);
  }

  return textResult(
    JSON.stringify({
      ok: true,
      repo,
      pr,
      ...(labels.length > 0 && { labels_removed: labels }),
      ...(reviewers.length > 0 && { reviewers_removed: reviewers }),
      ...(assignees.length > 0 && { assignees_removed: assignees }),
      ...(clearMilestone && { milestone_cleared: true }),
    })
  );
}

function getConfigValue(config: FirewatchConfig, key: string): unknown {
  const normalized = key.replaceAll("-", "_");
  const segments = normalized.split(".");
  let current: unknown = config;

  for (const segment of segments) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    const record = current as Record<string, unknown>;
    if (!(segment in record)) {
      return undefined;
    }
    current = record[segment];
  }

  return current;
}

async function handleConfig(params: FirewatchParams): Promise<McpToolResult> {
  if (params.value !== undefined) {
    throw new Error("config updates are not supported via MCP. Use the CLI.");
  }

  const config = await loadConfig();
  const configPaths = await getConfigPaths();
  const projectPath = await getProjectConfigPath();

  if (params.path) {
    return textResult(
      JSON.stringify({
        paths: {
          user: configPaths.user,
          project: projectPath,
          cache: PATHS.cache,
          repos: PATHS.repos,
          meta: PATHS.meta,
        },
      })
    );
  }

  if (params.key) {
    const value = getConfigValue(redactConfig(config), params.key);
    return textResult(
      JSON.stringify({
        ok: value !== undefined,
        key: params.key,
        value,
      })
    );
  }

  return textResult(
    JSON.stringify({
      config: redactConfig(config),
      paths: {
        user: configPaths.user,
        project: projectPath,
      },
    })
  );
}

async function handleDoctor(params: FirewatchParams): Promise<McpToolResult> {
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
  try {
    const response = await fetch("https://api.github.com/rate_limit", {
      headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : {},
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

  if (!auth.token) {
    issues.push({
      check: "auth",
      message: auth.error ?? "No GitHub auth available",
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
        ok: Boolean(auth.token),
        source: auth.source,
        ...(auth.error && { error: auth.error }),
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

// ─────────────────────────────────────────────────────────────────────────────
// Feedback (fw fb parity)
// ─────────────────────────────────────────────────────────────────────────────

interface UnaddressedFeedback {
  repo: string;
  pr: number;
  pr_title: string;
  pr_branch: string;
  comment_id: string;
  author: string;
  body?: string | undefined;
  created_at: string;
  file?: string | undefined;
  line?: number | undefined;
  subtype?: string | undefined;
}

function isBot(author: string): boolean {
  return shouldExcludeAuthor(author, {
    excludeList: DEFAULT_EXCLUDE_AUTHORS,
    botPatterns: DEFAULT_BOT_PATTERNS,
    excludeBots: true,
  });
}

/**
 * Identify feedback that needs attention (unresolved review comments).
 * Filters to review_comment subtype only, excludes acked IDs.
 */
function identifyUnaddressedFeedback(
  entries: FirewatchEntry[],
  ackedIds: Set<string>
): UnaddressedFeedback[] {
  const commentEntries = entries.filter(isCommentEntry);

  // Build commit map for fallback heuristics
  const commitsByRepoPr = new Map<string, FirewatchEntry[]>();
  for (const entry of entries) {
    if (entry.type === "commit") {
      const key = `${entry.repo}:${entry.pr}`;
      const existing = commitsByRepoPr.get(key) ?? [];
      existing.push(entry);
      commitsByRepoPr.set(key, existing);
    }
  }

  const hasLaterCommit = (
    repo: string,
    pr: number,
    createdAt: string
  ): boolean => {
    const key = `${repo}:${pr}`;
    const prCommits = commitsByRepoPr.get(key) ?? [];
    const time = new Date(createdAt).getTime();
    return prCommits.some((c) => new Date(c.created_at).getTime() > time);
  };

  return commentEntries
    .filter((comment) => {
      // Exclude acknowledged comments
      if (ackedIds.has(comment.id)) {
        return false;
      }

      // Ignore bot-authored comments and self-comments from the PR author
      if (isBot(comment.author)) {
        return false;
      }
      if (comment.author.toLowerCase() === comment.pr_author.toLowerCase()) {
        return false;
      }

      // Thread resolution is authoritative for review comments
      if (isReviewComment(comment) && comment.thread_resolved !== undefined) {
        return !comment.thread_resolved;
      }

      // Treat 👍 from PR author as acknowledgement
      if (comment.reactions?.thumbs_up_by?.length) {
        const author = comment.pr_author.toLowerCase();
        const acked = comment.reactions.thumbs_up_by.some(
          (login) => login.toLowerCase() === author
        );
        if (acked) {
          return false;
        }
      }

      // Fallback heuristics
      if (comment.file_activity_after) {
        return !comment.file_activity_after.modified;
      }

      if (!("file" in comment) || !comment.file) {
        return !hasLaterCommit(comment.repo, comment.pr, comment.created_at);
      }

      return !hasLaterCommit(comment.repo, comment.pr, comment.created_at);
    })
    .map((e) => ({
      repo: e.repo,
      pr: e.pr,
      pr_title: e.pr_title,
      pr_branch: e.pr_branch,
      comment_id: e.id,
      author: e.author,
      ...(e.body && { body: e.body.slice(0, 200) }),
      created_at: e.created_at,
      ...("file" in e && e.file && { file: e.file }),
      ...("line" in e && e.line !== undefined && { line: e.line }),
      ...(e.subtype && { subtype: e.subtype }),
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Feedback handler helpers
// ─────────────────────────────────────────────────────────────────────────────

interface FeedbackContext {
  repo: string;
  owner: string;
  name: string;
  config: FirewatchConfig;
  client: GitHubClient;
  detectedRepo: string | null;
}

async function createFeedbackContext(
  params: FeedbackParams
): Promise<FeedbackContext> {
  const config = await loadConfig();
  const detected = await detectRepo();
  const repo = params.repo ?? detected.repo;

  if (!repo) {
    throw new Error("No repository detected. Provide repo.");
  }

  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid repo format: ${repo}. Expected owner/repo.`);
  }

  const auth = await detectAuth(config.github_token);
  if (!auth.token) {
    throw new Error(auth.error);
  }

  const client = new GitHubClient(auth.token);
  await ensureRepoCacheIfNeeded(repo, config, detected.repo);

  return { repo, owner, name, config, client, detectedRepo: detected.repo };
}

function formatFeedbackOutput(fb: UnaddressedFeedback, repo: string) {
  return {
    id: formatShortId(generateShortId(fb.comment_id, repo)),
    gh_id: fb.comment_id,
    repo: fb.repo,
    pr: fb.pr,
    pr_title: fb.pr_title,
    author: fb.author,
    ...(fb.body && { body: fb.body }),
    created_at: fb.created_at,
    ...(fb.file && { file: fb.file }),
    ...(fb.line !== undefined && { line: fb.line }),
  };
}

async function handleRepoFeedbackList(
  ctx: FeedbackContext
): Promise<McpToolResult> {
  const entries = await queryEntries({
    filters: { repo: ctx.repo, type: "comment" },
  });
  buildShortIdCache(entries);

  const ackedIds = await getAckedIds(ctx.repo);
  const feedbacks = identifyUnaddressedFeedback(entries, ackedIds);
  const filtered = feedbacks.filter((fb) => !isBot(fb.author));
  const output = filtered.map((fb) => formatFeedbackOutput(fb, ctx.repo));

  return textResult(jsonLines(output));
}

async function handlePrBulkAck(
  ctx: FeedbackContext,
  pr: number
): Promise<McpToolResult> {
  const entries = await queryEntries({ filters: { repo: ctx.repo, pr } });
  buildShortIdCache(entries);

  const ackedIds = await getAckedIds(ctx.repo);
  const feedbacks = identifyUnaddressedFeedback(entries, ackedIds);
  const prFeedbacks = feedbacks
    .filter((fb) => fb.pr === pr)
    .filter((fb) => !isBot(fb.author));

  if (prFeedbacks.length === 0) {
    return textResult(
      JSON.stringify({ ok: true, repo: ctx.repo, pr, acked_count: 0 })
    );
  }

  // Add reactions in parallel using batch utility
  const commentIds = prFeedbacks.map((fb) => fb.comment_id);
  const reactionResults = await batchAddReactions(commentIds, ctx.client);

  // Build reaction map for ack records
  const reactionMap = new Map(
    reactionResults.map((r) => [r.commentId, r.reactionAdded])
  );

  const now = new Date().toISOString();
  const ackRecords: AckRecord[] = prFeedbacks.map((fb) => ({
    repo: ctx.repo,
    pr,
    comment_id: fb.comment_id,
    acked_at: now,
    ...(ctx.config.user?.github_username && {
      acked_by: ctx.config.user.github_username,
    }),
    reaction_added: reactionMap.get(fb.comment_id) ?? false,
  }));
  await addAcks(ackRecords);

  const reactionsAdded = reactionResults.filter((r) => r.reactionAdded).length;

  return textResult(
    JSON.stringify({
      ok: true,
      repo: ctx.repo,
      pr,
      acked_count: prFeedbacks.length,
      reactions_added: reactionsAdded,
    })
  );
}

async function handlePrAddComment(
  ctx: FeedbackContext,
  pr: number,
  body: string
): Promise<McpToolResult> {
  const prId = await ctx.client.fetchPullRequestId(ctx.owner, ctx.name, pr);
  const comment = await ctx.client.addIssueComment(prId, body);
  const shortId = formatShortId(generateShortId(comment.id, ctx.repo));

  return textResult(
    JSON.stringify({
      ok: true,
      repo: ctx.repo,
      pr,
      id: shortId,
      gh_id: comment.id,
      ...(comment.url && { url: comment.url }),
    })
  );
}

async function handlePrListFeedback(
  ctx: FeedbackContext,
  pr: number,
  showAll: boolean
): Promise<McpToolResult> {
  const entries = await queryEntries({ filters: { repo: ctx.repo, pr } });
  buildShortIdCache(entries);

  if (showAll) {
    const comments = entries.filter((e) => e.type === "comment");
    const output = comments.map((c) => ({
      id: formatShortId(generateShortId(c.id, ctx.repo)),
      gh_id: c.id,
      repo: c.repo,
      pr: c.pr,
      author: c.author,
      subtype: c.subtype,
      ...(c.body && { body: c.body.slice(0, 200) }),
      created_at: c.created_at,
      ...(c.file && { file: c.file }),
      ...(c.line !== undefined && { line: c.line }),
      ...(c.thread_resolved !== undefined && {
        thread_resolved: c.thread_resolved,
      }),
    }));
    return textResult(jsonLines(output));
  }

  const ackedIds = await getAckedIds(ctx.repo);
  const feedbacks = identifyUnaddressedFeedback(entries, ackedIds);
  const prFeedbacks = feedbacks
    .filter((fb) => fb.pr === pr)
    .filter((fb) => !isBot(fb.author));

  const output = prFeedbacks.map((fb) => formatFeedbackOutput(fb, ctx.repo));
  return textResult(jsonLines(output));
}

function handlePrFeedback(
  ctx: FeedbackContext,
  params: FeedbackParams
): Promise<McpToolResult> {
  const pr = requirePrNumber(params.pr, "feedback");

  if (params.ack) {
    return handlePrBulkAck(ctx, pr);
  }

  if (params.body) {
    return handlePrAddComment(ctx, pr, params.body);
  }

  return handlePrListFeedback(ctx, pr, Boolean(params.all));
}

async function resolveCommentId(
  rawId: string,
  repo: string
): Promise<{ commentId: string; shortIdDisplay: string }> {
  const idType = classifyId(rawId);

  if (idType === "short_id") {
    // Use batch resolution (queries, builds cache, resolves)
    const [resolution] = await resolveBatchIds([rawId], repo);

    if (resolution?.type === "comment" && resolution.entry) {
      return {
        commentId: resolution.entry.id,
        shortIdDisplay: resolution.shortId ?? formatShortId(rawId),
      };
    }

    throw new Error(
      `Short ID ${formatShortId(rawId)} not found in cache. Run fw_query or fw_fb first.`
    );
  }

  if (idType === "full_id") {
    return {
      commentId: rawId,
      shortIdDisplay: formatShortId(generateShortId(rawId, repo)),
    };
  }

  throw new Error(`Invalid ID format: ${rawId}`);
}

async function ackWithReaction(
  ctx: FeedbackContext,
  commentId: string,
  pr: number
): Promise<{ reactionAdded: boolean }> {
  let reactionAdded = false;
  try {
    await ctx.client.addReaction(commentId, "THUMBS_UP");
    reactionAdded = true;
  } catch {
    // Continue with local ack
  }

  const ackRecord: AckRecord = {
    repo: ctx.repo,
    pr,
    comment_id: commentId,
    acked_at: new Date().toISOString(),
    ...(ctx.config.user?.github_username && {
      acked_by: ctx.config.user.github_username,
    }),
    reaction_added: reactionAdded,
  };
  await addAck(ackRecord);

  return { reactionAdded };
}

async function handleCommentAck(
  ctx: FeedbackContext,
  commentId: string,
  shortIdDisplay: string,
  entry: FirewatchEntry
): Promise<McpToolResult> {
  const { reactionAdded } = await ackWithReaction(ctx, commentId, entry.pr);

  return textResult(
    JSON.stringify({
      ok: true,
      repo: ctx.repo,
      pr: entry.pr,
      id: shortIdDisplay,
      gh_id: commentId,
      acked: true,
      reaction_added: reactionAdded,
    })
  );
}

async function handleCommentResolve(
  ctx: FeedbackContext,
  commentId: string,
  shortIdDisplay: string,
  entry: FirewatchEntry
): Promise<McpToolResult> {
  if (entry.subtype !== "review_comment") {
    const { reactionAdded } = await ackWithReaction(ctx, commentId, entry.pr);

    return textResult(
      JSON.stringify({
        ok: true,
        repo: ctx.repo,
        pr: entry.pr,
        id: shortIdDisplay,
        gh_id: commentId,
        acked: true,
        reaction_added: reactionAdded,
        note: "Issue comments cannot be resolved, acknowledged instead.",
      })
    );
  }

  const threadMap = await ctx.client.fetchReviewThreadMap(
    ctx.owner,
    ctx.name,
    entry.pr
  );
  const threadId = threadMap.get(commentId);

  if (!threadId) {
    throw new Error(`No review thread found for comment ${shortIdDisplay}.`);
  }

  await ctx.client.resolveReviewThread(threadId);

  return textResult(
    JSON.stringify({
      ok: true,
      repo: ctx.repo,
      pr: entry.pr,
      id: shortIdDisplay,
      gh_id: commentId,
      thread_id: threadId,
      resolved: true,
    })
  );
}

async function handleCommentReply(
  ctx: FeedbackContext,
  params: FeedbackParams,
  commentId: string,
  shortIdDisplay: string,
  entry: FirewatchEntry
): Promise<McpToolResult> {
  const body = params.body!;

  if (entry.subtype === "review_comment") {
    const threadMap = await ctx.client.fetchReviewThreadMap(
      ctx.owner,
      ctx.name,
      entry.pr
    );
    const threadId = threadMap.get(commentId);

    if (!threadId) {
      throw new Error(`No review thread found for comment ${shortIdDisplay}.`);
    }

    const reply = await ctx.client.addReviewThreadReply(threadId, body);

    if (params.resolve) {
      await ctx.client.resolveReviewThread(threadId);
    }

    const replyShortId = formatShortId(generateShortId(reply.id, ctx.repo));

    return textResult(
      JSON.stringify({
        ok: true,
        repo: ctx.repo,
        pr: entry.pr,
        id: replyShortId,
        gh_id: reply.id,
        reply_to: shortIdDisplay,
        reply_to_gh_id: commentId,
        ...(params.resolve && { resolved: true }),
        ...(reply.url && { url: reply.url }),
      })
    );
  }

  const prId = await ctx.client.fetchPullRequestId(
    ctx.owner,
    ctx.name,
    entry.pr
  );
  const comment = await ctx.client.addIssueComment(prId, body);
  const newShortId = formatShortId(generateShortId(comment.id, ctx.repo));

  return textResult(
    JSON.stringify({
      ok: true,
      repo: ctx.repo,
      pr: entry.pr,
      id: newShortId,
      gh_id: comment.id,
      in_reply_to: shortIdDisplay,
      in_reply_to_gh_id: commentId,
      ...(comment.url && { url: comment.url }),
    })
  );
}

function viewComment(
  shortIdDisplay: string,
  entry: FirewatchEntry
): McpToolResult {
  return textResult(
    JSON.stringify({
      id: shortIdDisplay,
      gh_id: entry.id,
      repo: entry.repo,
      pr: entry.pr,
      pr_title: entry.pr_title,
      author: entry.author,
      subtype: entry.subtype,
      ...(entry.body && { body: entry.body }),
      created_at: entry.created_at,
      ...(entry.file && { file: entry.file }),
      ...(entry.line !== undefined && { line: entry.line }),
      ...(entry.thread_resolved !== undefined && {
        thread_resolved: entry.thread_resolved,
      }),
    })
  );
}

async function handleCommentFeedback(
  ctx: FeedbackContext,
  params: FeedbackParams
): Promise<McpToolResult> {
  const { commentId, shortIdDisplay } = await resolveCommentId(
    params.id!,
    ctx.repo
  );

  const entries = await queryEntries({
    filters: { repo: ctx.repo, id: commentId },
  });
  const entry = entries[0];

  if (!entry) {
    throw new Error(`Comment ${shortIdDisplay} not found.`);
  }

  if (params.ack && !params.body && !params.resolve) {
    return handleCommentAck(ctx, commentId, shortIdDisplay, entry);
  }

  if (params.resolve && !params.body) {
    return handleCommentResolve(ctx, commentId, shortIdDisplay, entry);
  }

  if (params.body) {
    return handleCommentReply(ctx, params, commentId, shortIdDisplay, entry);
  }

  return viewComment(shortIdDisplay, entry);
}

async function handleFeedback(params: FeedbackParams): Promise<McpToolResult> {
  const ctx = await createFeedbackContext(params);

  const hasPr = params.pr !== undefined;
  const hasId = params.id !== undefined;

  if (!hasPr && !hasId) {
    return handleRepoFeedbackList(ctx);
  }

  if (hasPr && !hasId) {
    return handlePrFeedback(ctx, params);
  }

  return handleCommentFeedback(ctx, params);
}

function schemaDoc(name: SchemaName | undefined): object {
  if (name === "worklist") {
    return WORKLIST_SCHEMA_DOC;
  }
  if (name === "config") {
    return CONFIG_SCHEMA_DOC;
  }
  return ENTRY_SCHEMA_DOC;
}

function buildHelpText(writeToolsAvailable: boolean): string {
  const baseText = `Firewatch MCP Tools

fw_query - Query cached PR activity
  Filter by: since, type, pr, author, state, label
  Options: summary=true (per-PR aggregation), summary_short=true (compact)
  Example: {"since":"24h","type":"review","summary":true}

fw_status - Cache and auth status
  Options: short=true (compact output)

fw_doctor - Diagnose and fix issues
  Options: fix=true (auto-repair)

fw_help - Usage documentation
  schema: "query" | "entry" | "worklist" | "config" - field definitions
  config_key: show config value
  config_path: show config file location`;

  const writeToolsText = `

fw_pr - PR mutations
  action="edit" - Update title, body, base, draft/ready, milestone, labels, reviewers, assignees
  action="rm" - Remove labels, reviewers, assignees, milestone
  action="review" - Submit review (approve/request-changes/comment)

fw_fb - Unified feedback operations
  PR-level:
    {pr} - List needs-attention feedback
    {pr, all} - List all including resolved/acked
    {pr, body} - Add comment to PR
    {pr, ack} - Bulk ack all
  Comment-level:
    {id} - View comment
    {id, body} - Reply
    {id, resolve} - Resolve thread (or ack issue_comment)
    {id, ack} - Acknowledge with thumbs-up`;

  const lockedText = `

Note: Write tools (fw_pr, fw_fb) require authentication.
Use fw_doctor to check auth status.`;

  return writeToolsAvailable
    ? baseText + writeToolsText
    : baseText + lockedText;
}

/**
 * FirewatchMCPServer wraps McpServer to provide auth-gated dynamic tool registration.
 *
 * Base tools (fw_query, fw_status, fw_doctor, fw_help) are always available.
 * Write tools (fw_pr, fw_fb) require authentication and are
 * dynamically registered after auth verification.
 */
export class FirewatchMCPServer {
  readonly server: McpServer;
  private _isAuthenticated = false;
  private _writeToolsRegistered = false;
  private _authResult: AuthResult | null = null;

  constructor() {
    this.server = new McpServer(
      { name: "firewatch", version: mcpVersion },
      {
        instructions:
          "Query GitHub PR activity including reviews, comments, commits, and CI status. Use when checking PR status, finding review comments, querying activity, resolving feedback, or working with GitHub pull requests. Outputs JSONL for jq composition.",
      }
    );

    this.registerBaseTools();
  }

  /**
   * Check if write tools are available (auth verified).
   */
  get writeToolsAvailable(): boolean {
    return this._writeToolsRegistered;
  }

  /**
   * Verify authentication and enable write tools if authenticated.
   * Safe to call multiple times - will only register tools once.
   * Sends list_changed notification when tools are newly registered.
   */
  async verifyAuthAndEnableWriteTools(): Promise<{
    authenticated: boolean;
    toolsEnabled: boolean;
    source?: string | undefined;
    error?: string | undefined;
  }> {
    // If already registered, return current state
    if (this._writeToolsRegistered) {
      return {
        authenticated: this._isAuthenticated,
        toolsEnabled: true,
        ...(this._authResult?.source && { source: this._authResult.source }),
      };
    }

    // Check auth
    const config = await loadConfig();
    const auth = await detectAuth(config.github_token);
    this._authResult = auth;

    if (!auth.token) {
      return {
        authenticated: false,
        toolsEnabled: false,
        ...(auth.error && { error: auth.error }),
      };
    }

    // Auth succeeded - register write tools
    this._isAuthenticated = true;
    this.registerWriteTools();
    this._writeToolsRegistered = true;

    // Notify client that tool list has changed
    this.server.sendToolListChanged();

    return {
      authenticated: true,
      toolsEnabled: true,
      source: auth.source,
    };
  }

  /**
   * Register base tools that are always available (read-only operations).
   */
  private registerBaseTools(): void {
    // fw_query - Query cached PR activity
    this.server.tool(
      "fw_query",
      TOOL_DESCRIPTIONS.query,
      QueryParamsShape,
      (params: QueryParams) => handleQuery(params)
    );

    // fw_status - Show cache and auth status
    this.server.tool(
      "fw_status",
      TOOL_DESCRIPTIONS.status,
      StatusParamsShape,
      this.handleStatusWithRecheck.bind(this)
    );

    // fw_doctor - Diagnose and fix issues
    this.server.tool(
      "fw_doctor",
      TOOL_DESCRIPTIONS.doctor,
      DoctorParamsShape,
      (params: DoctorParams) => handleDoctor(params)
    );

    // fw_help - Usage documentation
    this.server.tool(
      "fw_help",
      TOOL_DESCRIPTIONS.help,
      HelpParamsShape,
      this.handleHelp.bind(this)
    );
  }

  /**
   * Handle help tool requests.
   */
  private async handleHelp(params: HelpParams): Promise<McpToolResult> {
    if (params.schema) {
      return textResult(JSON.stringify(schemaDoc(params.schema), null, 2));
    }
    if (params.config_key || params.config_path) {
      return await handleConfig({
        key: params.config_key,
        path: params.config_path,
      });
    }
    return textResult(buildHelpText(this._writeToolsRegistered));
  }

  /**
   * Handle status tool requests with optional auth recheck.
   * Allows clients to trigger auth re-verification to enable write tools.
   */
  private async handleStatusWithRecheck(
    params: StatusParams
  ): Promise<McpToolResult> {
    // If recheck_auth is requested, verify auth and possibly enable write tools
    if (params.recheck_auth) {
      const authResult = await this.verifyAuthAndEnableWriteTools();
      // Include auth recheck result in status output
      const status = await handleStatus(params);
      // Append auth recheck info to response
      if (status.content[0]?.type === "text") {
        const original = JSON.parse(status.content[0].text);
        const enhanced = {
          ...original,
          auth_recheck: {
            authenticated: authResult.authenticated,
            tools_enabled: authResult.toolsEnabled,
            ...(authResult.source && { source: authResult.source }),
            ...(authResult.error && { error: authResult.error }),
          },
        };
        return textResult(JSON.stringify(enhanced));
      }
      return status;
    }
    return handleStatus(params);
  }

  /**
   * Register write tools that require authentication.
   * Called after auth verification succeeds.
   */
  private registerWriteTools(): void {
    // fw_pr - PR mutations: edit fields, manage metadata, submit reviews
    this.server.tool(
      "fw_pr",
      TOOL_DESCRIPTIONS.pr,
      PrParamsShape,
      (params: PrParams) => {
        if (params.action === "review") {
          // Submit PR review - validate review type is provided
          if (!params.review) {
            throw new Error(
              "action=review requires review type (approve, request-changes, comment)."
            );
          }
          return handleAdd({
            pr: params.pr,
            repo: params.repo,
            review: params.review,
            body: params.body,
          });
        }
        if (params.action === "edit") {
          // Handle metadata additions via edit
          const hasMetadata =
            params.labels || params.label || params.reviewer || params.assignee;
          if (hasMetadata && !hasEditFields(params)) {
            // Pure metadata add
            return handleAdd({
              pr: params.pr,
              repo: params.repo,
              labels: params.labels,
              label: params.label,
              reviewer: params.reviewer,
              assignee: params.assignee,
            });
          }
          return handleEdit(params);
        }
        return handleRm(params);
      }
    );

    // fw_fb - Unified feedback operations (fw fb parity)
    this.server.tool(
      "fw_fb",
      TOOL_DESCRIPTIONS.fb,
      FeedbackParamsShape,
      (params: FeedbackParams) => handleFeedback(params)
    );
  }

  /**
   * Connect to transport and optionally verify auth immediately.
   */
  async connect(
    transport: StdioServerTransport,
    options: { verifyAuthOnConnect?: boolean } = {}
  ): Promise<void> {
    await this.server.connect(transport);

    // Optionally verify auth on connect to enable write tools early
    if (options.verifyAuthOnConnect) {
      await this.verifyAuthAndEnableWriteTools();
    }
  }

  /**
   * Close the server connection.
   */
  async close(): Promise<void> {
    await this.server.close();
  }
}

/**
 * Create a new FirewatchMCPServer instance.
 * For backward compatibility with existing code.
 */
export function createServer(): FirewatchMCPServer {
  return new FirewatchMCPServer();
}

export async function run(): Promise<void> {
  const firewatch = createServer();
  const transport = new StdioServerTransport();

  // Connect to transport and verify auth to enable write tools
  await firewatch.connect(transport, { verifyAuthOnConnect: true });
}
