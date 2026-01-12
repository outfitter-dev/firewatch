import { $ } from "bun";
import {
  GitHubClient,
  buildLookoutContext,
  buildLookoutSummary,
  buildWorklist,
  checkRepo,
  detectAuth,
  detectRepo,
  ensureDirectories,
  getRepoCachePath,
  loadConfig,
  parseSince,
  queryEntries,
  setLookoutFor,
  sortWorklist,
  syncRepo,
  type FirewatchConfig,
  type FirewatchEntry,
  type PrState,
} from "@outfitter/firewatch-core";
import {
  ENTRY_SCHEMA_DOC,
  WORKLIST_SCHEMA_DOC,
} from "@outfitter/firewatch-core/schema";
import { getGraphiteStacks, graphitePlugin } from "@outfitter/firewatch-core/plugins";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const ActionSchema = z.enum([
  "query",
  "sync",
  "check",
  "status",
  "lookout",
  "comment",
  "resolve",
  "schema",
  "help",
]);

type SchemaName = "query" | "entry" | "worklist";

const FirewatchParamsShape = {
  action: ActionSchema,
  repo: z.string().optional(),
  pr: z.number().int().positive().optional(),
  type: z.enum(["comment", "review", "commit", "ci", "event"]).optional(),
  author: z.string().optional(),
  states: z
    .array(z.enum(["open", "closed", "merged", "draft"]))
    .optional(),
  label: z.string().optional(),
  since: z.string().optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  stack_id: z.string().optional(),
  group_stack: z.boolean().optional(),
  worklist: z.boolean().optional(),
  status_short: z.boolean().optional(),
  full: z.boolean().optional(),
  body: z.string().optional(),
  reply_to: z.string().optional(),
  resolve: z.boolean().optional(),
  comment_ids: z.array(z.string()).optional(),
  schema: z.enum(["query", "entry", "worklist"]).optional(),
  lookout_reset: z.boolean().optional(),
};

const FirewatchParamsSchema = z.object(FirewatchParamsShape);

type FirewatchParams = z.infer<typeof FirewatchParamsSchema>;

const server = new McpServer({ name: "firewatch", version: "0.1.0" });

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

function parseStates(
  provided: FirewatchParams["states"],
  config: FirewatchConfig
): PrState[] | undefined {
  if (provided && provided.length > 0) {
    return provided;
  }
  return config.default_states ?? ["open", "draft"];
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
  const cachePath = getRepoCachePath(repo);
  const file = Bun.file(cachePath);
  const hasCache = (await file.exists()) ? file.size > 0 : false;
  if (hasCache) {
    return;
  }

  await ensureDirectories();

  const auth = await detectAuth(config.github_token);
  if (!auth.token) {
    throw new Error(auth.error);
  }

  let graphiteEnabled = config.graphite_enabled ?? false;
  if (!graphiteEnabled && detectedRepo === repo) {
    graphiteEnabled = (await getGraphiteStacks()) !== null;
  }

  const plugins = graphiteEnabled && detectedRepo === repo ? [graphitePlugin] : [];
  const client = new GitHubClient(auth.token);
  await syncRepo(client, repo, { plugins });
}

async function resolveCommitFilesFromGit(
  commitId: string
): Promise<string[] | null> {
  const result = await $`git show --name-only --pretty= ${commitId}`
    .nothrow()
    .quiet();
  if (result.exitCode !== 0) {
    return null;
  }
  const text = result.text().trim();
  if (!text) {
    return [];
  }
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
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

function groupByStack(
  entries: FirewatchEntry[]
): { stack_id: string; entries: FirewatchEntry[] }[] {
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

function formatStatusShort(items: ReturnType<typeof buildWorklist>) {
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

async function handleQuery(params: FirewatchParams): Promise<McpToolResult> {
  const config = await loadConfig();
  const detected = await detectRepo();

  const repoFilter = params.repo ?? detected.repo ?? undefined;
  if (repoFilter) {
    await ensureRepoCache(repoFilter, config, detected.repo);
  }

  const states = parseStates(params.states, config);
  const since = params.since ?? config.default_since;

  const entries = await queryEntries({
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
  });

  let output = entries;

  if (params.stack_id || params.group_stack || params.worklist) {
    output = await enrichGraphite(entries);
  }

  if (params.stack_id) {
    output = output.filter((entry) => entry.graphite?.stack_id === params.stack_id);
  }

  if (params.worklist) {
    const worklist = sortWorklist(buildWorklist(output));
    return textResult(jsonLines(worklist));
  }

  if (params.group_stack) {
    const groups = groupByStack(output);
    return textResult(jsonLines(groups));
  }

  return textResult(jsonLines(output));
}

async function handleStatus(params: FirewatchParams): Promise<McpToolResult> {
  const config = await loadConfig();
  const detected = await detectRepo();
  const repoFilter = params.repo ?? detected.repo ?? undefined;

  if (repoFilter) {
    await ensureRepoCache(repoFilter, config, detected.repo);
  }

  const states = parseStates(params.states, config);
  const since = params.since ?? config.default_since;

  const entries = await queryEntries({
    filters: {
      ...(repoFilter && { repo: repoFilter }),
      ...(params.pr !== undefined && { pr: params.pr }),
      ...(states && { states }),
      ...(params.label && { label: params.label }),
      ...(since && { since: parseSince(since) }),
    },
  });

  const enriched = await enrichGraphite(entries);
  const worklist = sortWorklist(buildWorklist(enriched));

  if (params.status_short) {
    return textResult(jsonLines(formatStatusShort(worklist)));
  }

  return textResult(jsonLines(worklist));
}

async function handleLookout(params: FirewatchParams): Promise<McpToolResult> {
  await ensureDirectories();

  const config = await loadConfig();
  const detected = await detectRepo();

  const repoFilter = params.repo ?? detected.repo;
  if (!repoFilter) {
    throw new Error("No repository detected. Provide repo.");
  }

  const context = await buildLookoutContext({
    repo: repoFilter,
    since: params.since ? parseSince(params.since) : undefined,
    reset: params.lookout_reset,
    config,
  });

  let syncedAt: Date | undefined;
  if (context.syncNeeded) {
    const auth = await detectAuth(config.github_token);
    if (!auth.token) {
      throw new Error(auth.error ?? "Authentication failed");
    }

    const client = new GitHubClient(auth.token);
    const graphiteEnabled =
      config.graphite_enabled ||
      (detected.repo === context.repo && (await getGraphiteStacks()) !== null);

    await syncRepo(client, context.repo, {
      plugins: graphiteEnabled ? [graphitePlugin] : [],
    });

    syncedAt = new Date();
  }

  const entries = await queryEntries({
    filters: {
      repo: context.repo,
      since: context.since,
      states: ["open", "draft"],
    },
  });

  const summary = buildLookoutSummary(entries, context, syncedAt);
  await setLookoutFor(context.repo, context.until);

  return textResult(JSON.stringify(summary));
}

async function handleSync(params: FirewatchParams): Promise<McpToolResult> {
  await ensureDirectories();

  const config = await loadConfig();
  const detected = await detectRepo();
  const detectedRepo = detected.repo;

  const auth = await detectAuth(config.github_token);
  if (!auth.token) {
    throw new Error(auth.error);
  }

  const client = new GitHubClient(auth.token);

  const repos: string[] = [];
  if (params.repo) {
    repos.push(params.repo);
  } else if (config.repos.length > 0) {
    repos.push(...config.repos);
  } else if (detectedRepo) {
    repos.push(detectedRepo);
  }

  if (repos.length === 0) {
    throw new Error("No repository detected. Provide repo or configure repos.");
  }

  let graphiteEnabled = Boolean(config.graphite_enabled);
  if (!graphiteEnabled && detectedRepo) {
    graphiteEnabled = (await getGraphiteStacks()) !== null;
  }

  const results: {
    repo: string;
    prs_processed: number;
    entries_added: number;
  }[] = [];

  for (const repo of repos) {
    const useGraphite = graphiteEnabled && repo === detectedRepo;
    const result = await syncRepo(client, repo, {
      ...(params.full && { full: true }),
      ...(params.since && { since: parseSince(params.since) }),
      plugins: useGraphite ? [graphitePlugin] : [],
    });

    results.push({
      repo,
      prs_processed: result.prsProcessed,
      entries_added: result.entriesAdded,
    });
  }

  return textResult(jsonLines(results));
}

async function handleCheck(params: FirewatchParams): Promise<McpToolResult> {
  await ensureDirectories();

  const config = await loadConfig();
  const detected = await detectRepo();
  const detectedRepo = detected.repo;

  const repos: string[] = [];
  if (params.repo) {
    repos.push(params.repo);
  } else if (config.repos.length > 0) {
    repos.push(...config.repos);
  } else if (detectedRepo) {
    repos.push(detectedRepo);
  }

  if (repos.length === 0) {
    throw new Error("No repository detected. Provide repo or configure repos.");
  }

  const gitCheck = detectedRepo
    ? await $`git rev-parse --is-inside-work-tree`.nothrow().quiet()
    : null;
  const canUseGit = Boolean(detectedRepo) && Boolean(gitCheck && gitCheck.exitCode === 0);

  const results: {
    repo: string;
    comments_checked: number;
    entries_updated: number;
  }[] = [];

  for (const repo of repos) {
    const resolveCommitFiles =
      canUseGit && repo === detectedRepo ? resolveCommitFilesFromGit : undefined;
    const result = await checkRepo(
      repo,
      resolveCommitFiles ? { resolveCommitFiles } : undefined
    );
    results.push(result);
  }

  return textResult(jsonLines(results));
}

async function handleComment(
  params: FirewatchParams
): Promise<McpToolResult> {
  if (!params.pr || !params.body) {
    throw new Error("comment requires pr and body");
  }
  if (params.resolve && !params.reply_to) {
    throw new Error("resolve requires reply_to");
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

  if (params.reply_to) {
    const threadMap = await client.fetchReviewThreadMap(owner, name, params.pr);
    const threadId = threadMap.get(params.reply_to);
    if (!threadId) {
      throw new Error(`No review thread found for comment ${params.reply_to}.`);
    }

    const reply = await client.addReviewThreadReply(threadId, params.body);
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
  const comment = await client.addIssueComment(prId, params.body);

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
      throw new Error(`Comment ${commentId} is not a review comment thread entry.`);
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
        throw new Error(`No review thread found for comment ${target.commentId}.`);
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

async function handleResolve(
  params: FirewatchParams
): Promise<McpToolResult> {
  if (!params.comment_ids || params.comment_ids.length === 0) {
    throw new Error("resolve requires comment_ids");
  }
  if ((params.repo && !params.pr) || (!params.repo && params.pr)) {
    throw new Error("resolve requires both repo and pr when overriding lookup");
  }

  const config = await loadConfig();
  const auth = await detectAuth(config.github_token);
  if (!auth.token) {
    throw new Error(auth.error);
  }

  const client = new GitHubClient(auth.token);

  const targets =
    params.repo && params.pr
      ? params.comment_ids.map((commentId: string) => ({
          repo: params.repo!,
          pr: params.pr!,
          commentId,
        }))
      : await loadTargetsFromCache(params.comment_ids);

  const outputs = await resolveTargets(client, targets);
  return textResult(jsonLines(outputs));
}

function schemaDoc(name: SchemaName | undefined): object {
  if (name === "worklist") {
    return WORKLIST_SCHEMA_DOC;
  }
  return ENTRY_SCHEMA_DOC;
}

function buildHelpText(): string {
  return `Firewatch MCP\n\nActions:\n- query: filter cached entries\n- sync: fetch from GitHub\n- check: refresh staleness hints\n- status: worklist summary (status_short for tight view)\n- lookout: PR reconnaissance (what needs attention since last check)\n- comment: post a comment or reply\n- resolve: resolve review threads\n- schema: output schema docs\n- help: this message\n\nExample:\n{"action":"query","since":"24h","type":"review"}\n{"action":"lookout"}\n{"action":"lookout","lookout_reset":true}`;
}

server.tool("firewatch", FirewatchParamsShape, (params) => {
  switch (params.action) {
    case "query":
      return handleQuery(params);
    case "sync":
      return handleSync(params);
    case "check":
      return handleCheck(params);
    case "status":
      return handleStatus(params);
    case "comment":
      return handleComment(params);
    case "resolve":
      return handleResolve(params);
    case "schema":
      return textResult(JSON.stringify(schemaDoc(params.schema), null, 2));
    case "help":
      return textResult(buildHelpText());
    default:
      return textResult("Unknown action");
  }
});

export async function run(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
