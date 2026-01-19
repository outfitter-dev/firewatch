import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  GitHubClient,
  PATHS,
  countEntries,
  detectAuth,
  detectRepo,
  ensureDirectories,
  getAllSyncMeta,
  getConfigPaths,
  getDatabase,
  getProjectConfigPath,
  getRepos,
  getSyncMeta,
  loadConfig,
  mergeExcludeAuthors,
  parseDurationMs,
  parseSince,
  queryEntries,
  syncRepo,
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
import { z } from "zod";

import { version as mcpVersion } from "../package.json";
import {
  buildQueryContext,
  buildQueryOptions,
  resolveQueryOutput,
} from "./query";

const ActionSchema = z.enum([
  "query",
  "add",
  "close",
  "edit",
  "rm",
  "status",
  "config",
  "doctor",
  "schema",
  "help",
]);

type SchemaName = "query" | "entry" | "worklist" | "config";

const FirewatchParamsShape = {
  action: ActionSchema,
  repo: z.string().optional(),
  pr: z.number().int().positive().optional(),
  prs: z
    .union([
      z.number().int().positive(),
      z.array(z.number().int().positive()),
      z.string(),
    ])
    .optional(),
  type: z
    .union([
      z.enum(["comment", "review", "commit", "ci", "event"]),
      z.array(z.enum(["comment", "review", "commit", "ci", "event"])),
      z.string(),
    ])
    .optional(),
  author: z.union([z.string(), z.array(z.string())]).optional(),
  states: z.array(z.enum(["open", "closed", "merged", "draft"])).optional(),
  state: z.union([z.string(), z.array(z.string())]).optional(),
  open: z.boolean().optional(),
  closed: z.boolean().optional(),
  draft: z.boolean().optional(),
  active: z.boolean().optional(),
  label: z.string().optional(),
  since: z.string().optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  summary: z.boolean().optional(),
  summary_short: z.boolean().optional(),
  orphaned: z.boolean().optional(),
  status_short: z.boolean().optional(),
  short: z.boolean().optional(),
  all: z.boolean().optional(),
  mine: z.boolean().optional(),
  reviews: z.boolean().optional(),
  no_bots: z.boolean().optional(),
  offline: z.boolean().optional(),
  refresh: z.union([z.boolean(), z.literal("full")]).optional(),
  body: z.string().optional(),
  reply_to: z.string().optional(),
  resolve: z.boolean().optional(),
  comment_ids: z.array(z.string()).optional(),
  comment_id: z.string().optional(),
  review: z.enum(["approve", "request-changes", "comment"]).optional(),
  reviewer: z.union([z.string(), z.array(z.string())]).optional(),
  assignee: z.union([z.string(), z.array(z.string())]).optional(),
  labels: z.union([z.string(), z.array(z.string())]).optional(),
  title: z.string().optional(),
  base: z.string().optional(),
  milestone: z.union([z.string(), z.boolean()]).optional(),
  ready: z.boolean().optional(),
  local: z.boolean().optional(),
  path: z.boolean().optional(),
  key: z.string().optional(),
  value: z.string().optional(),
  fix: z.boolean().optional(),
  schema: z.enum(["query", "entry", "worklist", "config"]).optional(),
};

const FirewatchParamsSchema = z.object(FirewatchParamsShape);

type FirewatchParams = z.infer<typeof FirewatchParamsSchema>;

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
interface ResolveOutput {
  ok: boolean;
  repo: string;
  pr: number;
  comment_id: string;
  thread_id: string;
}

interface ResolveTarget {
  repo: string;
  pr: number;
  commentId: string;
}

async function loadTargetsFromCache(
  commentIds: string[]
): Promise<ResolveTarget[]> {
  const targets: ResolveTarget[] = [];

  for (const commentId of commentIds) {
    const entries = await queryEntries({ filters: { id: commentId } });
    const entry = entries[0];
    if (!entry) {
      throw new Error(`Comment ${commentId} not found in cache.`);
    }
    if (entry.type !== "comment" || entry.subtype !== "review_comment") {
      throw new Error(
        `Comment ${commentId} is not a review comment thread entry.`
      );
    }
    targets.push({ repo: entry.repo, pr: entry.pr, commentId });
  }

  return targets;
}

function groupTargets(targets: ResolveTarget[]): Map<string, ResolveTarget[]> {
  const grouped = new Map<string, ResolveTarget[]>();
  for (const target of targets) {
    const key = `${target.repo}#${target.pr}`;
    const group = grouped.get(key) ?? [];
    group.push(target);
    grouped.set(key, group);
  }
  return grouped;
}

async function resolveTargets(
  client: GitHubClient,
  targets: ResolveTarget[]
): Promise<ResolveOutput[]> {
  const outputs: ResolveOutput[] = [];
  const grouped = groupTargets(targets);

  for (const group of grouped.values()) {
    const { repo, pr } = group[0]!;
    const [owner, name] = repo.split("/");
    if (!owner || !name) {
      throw new Error(`Invalid repo format: ${repo}`);
    }
    const threadMap = await client.fetchReviewThreadMap(owner, name, pr);
    for (const target of group) {
      const threadId = threadMap.get(target.commentId);
      if (!threadId) {
        throw new Error(
          `No review thread found for comment ${target.commentId}.`
        );
      }
      await client.resolveReviewThread(threadId);
      outputs.push({
        ok: true,
        repo,
        pr,
        comment_id: target.commentId,
        thread_id: threadId,
      });
    }
  }

  return outputs;
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
    const threadMap = await client.fetchReviewThreadMap(owner, name, params.pr);
    const threadId = threadMap.get(params.reply_to);
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
        reply_to: params.reply_to,
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

async function handleClose(params: FirewatchParams): Promise<McpToolResult> {
  const ids =
    params.comment_ids ?? (params.comment_id ? [params.comment_id] : []);
  if (ids.length === 0) {
    throw new Error("close requires comment_id or comment_ids.");
  }

  if ((params.repo && !params.pr) || (!params.repo && params.pr)) {
    throw new Error("close requires both repo and pr when overriding lookup.");
  }

  const config = await loadConfig();
  const auth = await detectAuth(config.github_token);
  if (!auth.token) {
    throw new Error(auth.error);
  }

  const client = new GitHubClient(auth.token);

  const targets =
    params.repo && params.pr
      ? ids.map((commentId) => ({
          repo: params.repo!,
          pr: params.pr!,
          commentId,
        }))
      : await loadTargetsFromCache(ids);

  const outputs = await resolveTargets(client, targets);
  return textResult(jsonLines(outputs));
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

function schemaDoc(name: SchemaName | undefined): object {
  if (name === "worklist") {
    return WORKLIST_SCHEMA_DOC;
  }
  if (name === "config") {
    return CONFIG_SCHEMA_DOC;
  }
  return ENTRY_SCHEMA_DOC;
}

function buildHelpText(): string {
  return `Firewatch MCP\n\nActions:\n- query: filter cached entries (summary/summary_short for worklist)\n- add: add comment/reply/review or metadata\n- close: resolve review threads\n- edit: update PR fields or draft/ready\n- rm: remove labels/reviewers/assignees/milestone\n- status: firewatch state info (status_short for compact)\n- config: view config (read-only)\n- doctor: diagnose auth/cache/repo\n- schema: output schema docs\n- help: this message\n\nExample:\n{"action":"query","since":"24h","type":"review"}\n{"action":"query","summary":true,"summary_short":true}\n{"action":"status","status_short":true}`;
}

const TOOL_DESCRIPTION = `GitHub PR activity query tool. Outputs JSONL for jq.

START HERE: Call with {"action":"schema"} to get field names for jq filters.

Actions: query (filter entries), add (comment/reply/review/metadata), close (resolve threads), edit, rm, status (state info), config (read-only), doctor (diagnostics), schema, help.

Common: query with since="24h", type="review", summary=true for aggregated view.`;

export function createServer(): McpServer {
  const server = new McpServer({ name: "firewatch", version: mcpVersion });

  server.tool("firewatch", TOOL_DESCRIPTION, FirewatchParamsShape, (params) => {
    switch (params.action) {
      case "query":
        return handleQuery(params);
      case "status":
        return handleStatus(params);
      case "add":
        return handleAdd(params);
      case "close":
        return handleClose(params);
      case "edit":
        return handleEdit(params);
      case "rm":
        return handleRm(params);
      case "config":
        return handleConfig(params);
      case "doctor":
        return handleDoctor(params);
      case "schema":
        return textResult(JSON.stringify(schemaDoc(params.schema), null, 2));
      case "help":
        return textResult(buildHelpText());
      default:
        return textResult("Unknown action");
    }
  });

  return server;
}

export async function run(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
