import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  GitHubClient,
  PATHS,
  addAck,
  addAcks,
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
  isShortId,
  loadConfig,
  mergeExcludeAuthors,
  parseDurationMs,
  parseSince,
  queryEntries,
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
  buildQueryContext,
  buildQueryOptions,
  resolveQueryOutput,
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
  pr?: number | undefined;
  prs?: number | number[] | string | undefined;
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
  closed?: boolean | undefined;
  draft?: boolean | undefined;
  active?: boolean | undefined;
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
  offline?: boolean | undefined;
  refresh?: boolean | "full" | undefined;
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
  ready?: boolean | undefined;
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

  if (params.active) {
    return ["open", "draft"];
  }

  const combined: PrState[] = [];
  if (params.open) {
    combined.push("open");
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

  // If not in cache, build cache from entries and try again
  const repoFilter = repo ?? (await resolveRepo());
  if (!repoFilter) {
    throw new Error("Cannot resolve short ID without repo context.");
  }

  const entries = await queryEntries({
    filters: {
      repo: repoFilter,
      type: "comment",
    },
  });

  buildShortIdCache(entries);

  const resolved = resolveShortId(id);
  if (resolved) {
    return resolved.fullId;
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
  options: { offline?: boolean } = {}
): Promise<void> {
  if (!repoFilter || !isFullRepo(repoFilter)) {
    return;
  }

  const hasCached = hasRepoCache(repoFilter);

  if (options.offline) {
    if (!hasCached) {
      throw new Error(`Offline mode: no cache for ${repoFilter}.`);
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

function resolveSummaryFlags(params: FirewatchParams): {
  wantsSummary: boolean;
  wantsSummaryShort: boolean;
} {
  const wantsSummaryShort = Boolean(params.summary_short);
  const wantsSummary = Boolean(params.summary || wantsSummaryShort);

  return { wantsSummary, wantsSummaryShort };
}

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

function addShortIds(entries: FirewatchEntry[]): FirewatchEntry[] {
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

async function handleQuery(params: FirewatchParams): Promise<McpToolResult> {
  const config = await loadConfig();
  const detected = await detectRepo();
  const detectedRepo = params.all ? null : detected.repo;

  if (params.mine && params.reviews) {
    throw new Error("Cannot use mine and reviews together.");
  }

  if (params.orphaned && params.open) {
    throw new Error(
      "Cannot use orphaned with open (orphaned implies merged/closed PRs)."
    );
  }

  const states = resolveStates(params);
  const labelFilter = resolveLabelFilter(params.label);
  const typeList = resolveTypeList(params.type);
  const prList = [
    ...toNumberList(params.prs),
    ...(params.pr ? [params.pr] : []),
  ];
  const { include: includeAuthors, exclude: excludeAuthors } =
    resolveAuthorLists(params.author);

  const { wantsSummary, wantsSummaryShort } = resolveSummaryFlags(params);

  if (params.refresh) {
    if (params.offline) {
      throw new Error("Cannot refresh while offline.");
    }

    const repos = resolveSyncRepos(params, config, detected.repo);
    if (repos.length === 0) {
      throw new Error(
        "No repository detected. Provide repo or configure repos."
      );
    }

    const syncOptions = {
      ...(params.refresh === "full" && { full: true }),
      ...(params.since && { since: params.since }),
    };
    await performSync(repos, config, detected.repo, syncOptions);
  }

  const queryParams = {
    repo: params.all ? undefined : params.repo,
    pr: prList.length === 1 ? prList[0] : undefined,
    prs: prList.length > 1 ? prList : undefined,
    type: typeList.length > 0 ? typeList : undefined,
    states,
    label: labelFilter,
    since: params.since ?? (params.orphaned ? "7d" : undefined),
    limit: params.limit,
    offset: params.offset,
    summary: wantsSummary,
  };

  const context = buildQueryContext(queryParams, detectedRepo);

  const cacheOptions = params.offline ? { offline: true } : {};
  await ensureRepoCacheIfNeeded(
    context.repoFilter,
    config,
    detected.repo,
    cacheOptions
  );

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
    excludeAuthors.length > 0 || configExclusions.length > 0 || excludeBots
      ? mergeExcludeAuthors(
          [...configExclusions, ...excludeAuthors],
          excludeBots
        )
      : undefined;

  const queryOptions = buildQueryOptions(queryParams, context);
  const entries = await queryEntries({
    ...queryOptions,
    filters: {
      ...queryOptions.filters,
      ...(excludeAuthorsMerged && { excludeAuthors: excludeAuthorsMerged }),
      ...(excludeBots && { excludeBots }),
      ...(botPatterns.length > 0 && { botPatterns }),
      ...(params.orphaned && { orphaned: true }),
    },
  });

  let filtered = entries;
  filtered = filterByPrs(filtered, prList);
  filtered = filterByTypes(filtered, typeList);
  filtered = filterByAuthors(filtered, includeAuthors);

  if (params.mine || params.reviews) {
    const username = config.user?.github_username;
    if (!username) {
      throw new Error(
        "user.github_username must be set for mine/reviews filters."
      );
    }
    filtered = filtered.filter((entry) =>
      params.mine ? entry.pr_author === username : entry.pr_author !== username
    );
  }

  const output = await resolveQueryOutput(queryParams, filtered, context, {
    enrichGraphite,
  });

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

async function handleAdd(params: FirewatchParams): Promise<McpToolResult> {
  if (!params.pr) {
    throw new Error("add requires pr.");
  }

  if (params.resolve && !params.reply_to) {
    throw new Error("resolve requires reply_to.");
  }

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
    const review = await client.addReview(
      owner,
      name,
      params.pr,
      params.review!,
      params.body
    );
    return textResult(
      JSON.stringify({
        ok: true,
        repo,
        pr: params.pr,
        review: params.review,
        ...(review?.id && { review_id: review.id }),
        ...(review?.url && { url: review.url }),
      })
    );
  }

  if (hasMetadata) {
    if (labels.length > 0) {
      await client.addLabels(owner, name, params.pr, labels);
    }
    if (reviewers.length > 0) {
      await client.requestReviewers(owner, name, params.pr, reviewers);
    }
    if (assignees.length > 0) {
      await client.addAssignees(owner, name, params.pr, assignees);
    }

    return textResult(
      JSON.stringify({
        ok: true,
        repo,
        pr: params.pr,
        ...(labels.length > 0 && { labels_added: labels }),
        ...(reviewers.length > 0 && { reviewers_added: reviewers }),
        ...(assignees.length > 0 && { assignees_added: assignees }),
      })
    );
  }

  const body = params.body ?? "";

  if (params.reply_to) {
    // Resolve short ID to full comment ID if needed
    const replyToId = await resolveCommentIdFromShortId(params.reply_to, repo);
    const threadMap = await client.fetchReviewThreadMap(owner, name, params.pr);
    const threadId = threadMap.get(replyToId);
    if (!threadId) {
      throw new Error(`No review thread found for comment ${params.reply_to}.`);
    }

    const reply = await client.addReviewThreadReply(threadId, body);
    if (params.resolve) {
      await client.resolveReviewThread(threadId);
    }

    return textResult(
      JSON.stringify({
        ok: true,
        repo,
        pr: params.pr,
        comment_id: reply.id,
        reply_to: replyToId,
        ...(params.resolve && { resolved: true }),
        ...(reply.url && { url: reply.url }),
      })
    );
  }

  const prId = await client.fetchPullRequestId(owner, name, params.pr);
  const comment = await client.addIssueComment(prId, body);

  return textResult(
    JSON.stringify({
      ok: true,
      repo,
      pr: params.pr,
      comment_id: comment.id,
      ...(comment.url && { url: comment.url }),
    })
  );
}

async function handleEdit(params: FirewatchParams): Promise<McpToolResult> {
  if (!params.pr) {
    throw new Error("edit requires pr.");
  }

  if (params.draft && params.ready) {
    throw new Error("edit cannot use draft and ready together.");
  }

  const milestoneName =
    typeof params.milestone === "string" ? params.milestone : undefined;
  if (params.milestone && !milestoneName) {
    throw new Error("edit milestone requires a string name.");
  }

  const hasEdit =
    params.title ||
    params.body ||
    params.base ||
    milestoneName ||
    params.draft ||
    params.ready;

  if (!hasEdit) {
    throw new Error("edit requires at least one field.");
  }

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

  if (params.title || params.body || params.base) {
    await client.editPullRequest(owner, name, params.pr, {
      ...(params.title && { title: params.title }),
      ...(params.body && { body: params.body }),
      ...(params.base && { base: params.base }),
    });
  }

  if (milestoneName) {
    await client.setMilestone(owner, name, params.pr, milestoneName);
  }

  if (params.draft || params.ready) {
    const prId = await client.fetchPullRequestId(owner, name, params.pr);
    if (params.draft) {
      await client.convertPullRequestToDraft(prId);
    }
    if (params.ready) {
      await client.markPullRequestReady(prId);
    }
  }

  return textResult(
    JSON.stringify({
      ok: true,
      repo,
      pr: params.pr,
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
  if (!params.pr) {
    throw new Error("rm requires pr.");
  }

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
    await client.removeLabels(owner, name, params.pr, labels);
  }
  if (reviewers.length > 0) {
    await client.removeReviewers(owner, name, params.pr, reviewers);
  }
  if (assignees.length > 0) {
    await client.removeAssignees(owner, name, params.pr, assignees);
  }
  if (clearMilestone) {
    await client.clearMilestone(owner, name, params.pr);
  }

  return textResult(
    JSON.stringify({
      ok: true,
      repo,
      pr: params.pr,
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
  // Only include review_comment subtype (inline code comments)
  const commentEntries = entries.filter(
    (e) => e.type === "comment" && e.subtype === "review_comment"
  );

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

      // Thread resolution is authoritative
      if (comment.thread_resolved !== undefined) {
        return !comment.thread_resolved;
      }

      // Fallback heuristics
      if (!comment.file) {
        return !hasLaterCommit(comment.repo, comment.pr, comment.created_at);
      }

      if (comment.file_activity_after) {
        return !comment.file_activity_after.modified;
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
      ...(e.file && { file: e.file }),
      ...(e.line !== undefined && { line: e.line }),
      ...(e.subtype && { subtype: e.subtype }),
    }));
}

async function handleFeedback(params: FeedbackParams): Promise<McpToolResult> {
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

  // Ensure cache exists
  await ensureRepoCacheIfNeeded(repo, config, detected.repo);

  // Route based on pr vs id
  const hasPr = params.pr !== undefined;
  const hasId = params.id !== undefined;

  if (!hasPr && !hasId) {
    // List all unaddressed feedback across repo
    const entries = await queryEntries({
      filters: { repo, type: "comment" },
    });
    buildShortIdCache(entries);

    const ackedIds = await getAckedIds(repo);
    const feedbacks = identifyUnaddressedFeedback(entries, ackedIds);

    // Filter out bots
    const filtered = feedbacks.filter((fb) => !isBot(fb.author));

    const output = filtered.map((fb) => ({
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
    }));

    return textResult(jsonLines(output));
  }

  if (hasPr && !hasId) {
    // PR-level operations
    const pr = params.pr!;

    // Bulk ack
    if (params.ack) {
      const entries = await queryEntries({ filters: { repo, pr } });
      buildShortIdCache(entries);

      const ackedIds = await getAckedIds(repo);
      const feedbacks = identifyUnaddressedFeedback(entries, ackedIds);
      const prFeedbacks = feedbacks
        .filter((fb) => fb.pr === pr)
        .filter((fb) => !isBot(fb.author));

      if (prFeedbacks.length === 0) {
        return textResult(
          JSON.stringify({ ok: true, repo, pr, acked_count: 0 })
        );
      }

      // Add reactions and local acks
      const results: { commentId: string; reactionAdded: boolean }[] = [];
      for (const fb of prFeedbacks) {
        let reactionAdded = false;
        try {
          await client.addReaction(fb.comment_id, "THUMBS_UP");
          reactionAdded = true;
        } catch {
          // Continue with local ack even if reaction fails
        }
        results.push({ commentId: fb.comment_id, reactionAdded });
      }

      const ackRecords: AckRecord[] = results.map((r) => ({
        repo,
        pr,
        comment_id: r.commentId,
        acked_at: new Date().toISOString(),
        reaction_added: r.reactionAdded,
      }));
      await addAcks(ackRecords);

      const reactionsAdded = results.filter((r) => r.reactionAdded).length;

      return textResult(
        JSON.stringify({
          ok: true,
          repo,
          pr,
          acked_count: prFeedbacks.length,
          reactions_added: reactionsAdded,
        })
      );
    }

    // Add new comment to PR
    if (params.body) {
      const prId = await client.fetchPullRequestId(owner, name, pr);
      const comment = await client.addIssueComment(prId, params.body);

      const shortId = formatShortId(generateShortId(comment.id, repo));

      return textResult(
        JSON.stringify({
          ok: true,
          repo,
          pr,
          id: shortId,
          gh_id: comment.id,
          ...(comment.url && { url: comment.url }),
        })
      );
    }

    // List feedback for PR
    const entries = await queryEntries({ filters: { repo, pr } });
    buildShortIdCache(entries);

    if (params.all) {
      // Show all comments
      const comments = entries.filter((e) => e.type === "comment");
      const output = comments.map((c) => ({
        id: formatShortId(generateShortId(c.id, repo)),
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

    // Show unaddressed feedback only
    const ackedIds = await getAckedIds(repo);
    const feedbacks = identifyUnaddressedFeedback(entries, ackedIds);
    const prFeedbacks = feedbacks
      .filter((fb) => fb.pr === pr)
      .filter((fb) => !isBot(fb.author));

    const output = prFeedbacks.map((fb) => ({
      id: formatShortId(generateShortId(fb.comment_id, repo)),
      gh_id: fb.comment_id,
      repo: fb.repo,
      pr: fb.pr,
      author: fb.author,
      ...(fb.body && { body: fb.body }),
      created_at: fb.created_at,
      ...(fb.file && { file: fb.file }),
      ...(fb.line !== undefined && { line: fb.line }),
    }));

    return textResult(jsonLines(output));
  }

  // Comment-level operations (hasId)
  const rawId = params.id!;
  const idType = classifyId(rawId);

  let commentId: string;
  let shortIdDisplay: string;

  if (idType === "short_id") {
    // Need to resolve short ID
    const entries = await queryEntries({ filters: { repo, type: "comment" } });
    buildShortIdCache(entries);

    const resolved = resolveShortId(rawId);
    if (!resolved) {
      throw new Error(
        `Short ID ${formatShortId(rawId)} not found in cache. Run fw_query or fw_fb first.`
      );
    }
    commentId = resolved.fullId;
    shortIdDisplay = formatShortId(rawId);
  } else if (idType === "full_id") {
    commentId = rawId;
    shortIdDisplay = formatShortId(generateShortId(commentId, repo));
  } else {
    throw new Error(`Invalid ID format: ${rawId}`);
  }

  // Get entry from cache
  const entries = await queryEntries({ filters: { repo, id: commentId } });
  const entry = entries[0];

  if (!entry) {
    throw new Error(`Comment ${shortIdDisplay} not found.`);
  }

  // Ack only
  if (params.ack && !params.body && !params.resolve) {
    let reactionAdded = false;
    try {
      await client.addReaction(commentId, "THUMBS_UP");
      reactionAdded = true;
    } catch {
      // Continue with local ack
    }

    const ackRecord: AckRecord = {
      repo,
      pr: entry.pr,
      comment_id: commentId,
      acked_at: new Date().toISOString(),
      reaction_added: reactionAdded,
    };
    await addAck(ackRecord);

    return textResult(
      JSON.stringify({
        ok: true,
        repo,
        pr: entry.pr,
        id: shortIdDisplay,
        gh_id: commentId,
        acked: true,
        reaction_added: reactionAdded,
      })
    );
  }

  // Resolve only (no body)
  if (params.resolve && !params.body) {
    if (entry.subtype !== "review_comment") {
      // Issue comment - ack instead of resolve
      let reactionAdded = false;
      try {
        await client.addReaction(commentId, "THUMBS_UP");
        reactionAdded = true;
      } catch {
        // Continue with local ack
      }

      const ackRecord: AckRecord = {
        repo,
        pr: entry.pr,
        comment_id: commentId,
        acked_at: new Date().toISOString(),
        reaction_added: reactionAdded,
      };
      await addAck(ackRecord);

      return textResult(
        JSON.stringify({
          ok: true,
          repo,
          pr: entry.pr,
          id: shortIdDisplay,
          gh_id: commentId,
          acked: true,
          reaction_added: reactionAdded,
          note: "Issue comments cannot be resolved, acknowledged instead.",
        })
      );
    }

    // Review comment - resolve thread
    const threadMap = await client.fetchReviewThreadMap(owner, name, entry.pr);
    const threadId = threadMap.get(commentId);

    if (!threadId) {
      throw new Error(`No review thread found for comment ${shortIdDisplay}.`);
    }

    await client.resolveReviewThread(threadId);

    return textResult(
      JSON.stringify({
        ok: true,
        repo,
        pr: entry.pr,
        id: shortIdDisplay,
        gh_id: commentId,
        thread_id: threadId,
        resolved: true,
      })
    );
  }

  // Reply (with optional resolve)
  if (params.body) {
    if (entry.subtype === "review_comment") {
      // Reply to review thread
      const threadMap = await client.fetchReviewThreadMap(
        owner,
        name,
        entry.pr
      );
      const threadId = threadMap.get(commentId);

      if (!threadId) {
        throw new Error(
          `No review thread found for comment ${shortIdDisplay}.`
        );
      }

      const reply = await client.addReviewThreadReply(threadId, params.body);

      if (params.resolve) {
        await client.resolveReviewThread(threadId);
      }

      const replyShortId = formatShortId(generateShortId(reply.id, repo));

      return textResult(
        JSON.stringify({
          ok: true,
          repo,
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

    // Issue comment - add new comment (can't thread on issue comments)
    const prId = await client.fetchPullRequestId(owner, name, entry.pr);
    const comment = await client.addIssueComment(prId, params.body);

    const newShortId = formatShortId(generateShortId(comment.id, repo));

    return textResult(
      JSON.stringify({
        ok: true,
        repo,
        pr: entry.pr,
        id: newShortId,
        gh_id: comment.id,
        in_reply_to: shortIdDisplay,
        in_reply_to_gh_id: commentId,
        ...(comment.url && { url: comment.url }),
      })
    );
  }

  // View comment (no mutation params)
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

  return writeToolsAvailable ? baseText + writeToolsText : baseText + lockedText;
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
      (params: StatusParams) => handleStatus(params)
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
          // Submit PR review
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
          if (
            hasMetadata &&
            !params.title &&
            !params.body &&
            !params.base &&
            !params.draft &&
            !params.ready &&
            !params.milestone
          ) {
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
