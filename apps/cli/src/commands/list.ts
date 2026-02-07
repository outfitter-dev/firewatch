/**
 * List command - verb-first entry point for listing feedback and PRs.
 *
 * Usage:
 *   fw list              - List feedback needing attention (default)
 *   fw list feedback     - Explicit feedback list
 *   fw list prs          - List PRs
 */

import {
  GitHubClient,
  buildShortIdCache,
  detectAuth,
  formatDisplayId,
  generateShortId,
  getAckedIds,
  getCurrentBranch,
  getStackProvider,
  loadConfig,
  parseSince,
  queryEntries,
  type FirewatchConfig,
  type PrState,
  type StackDirection,
} from "@outfitter/firewatch-core";
import { Command, Option } from "commander";

import {
  identifyUnaddressedFeedback,
  type UnaddressedFeedback,
} from "../actionable";
import { applyCommonOptions } from "../query-helpers";
import {
  SEPARATOR,
  formatFeedbackItem,
  formatPrFeedbackHeader,
  s,
  truncate,
} from "../render";
import { parseRepoInput, resolveRepoOrThrow } from "../repo";
import { outputStructured } from "../utils/json";
import { resolveStates } from "../utils/states";
import { shouldOutputJson } from "../utils/tty";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ListContext {
  client: GitHubClient | null;
  config: FirewatchConfig;
  repo: string;
  owner: string;
  name: string;
  outputJson: boolean;
}

interface ListFeedbackOptions {
  repo?: string;
  pr?: string;
  stack?: string | boolean;
  all?: boolean;
  since?: string;
  before?: string;
  open?: boolean;
  closed?: boolean;
  state?: string;
  stale?: boolean;
  long?: boolean;
  jsonl?: boolean;
  json?: boolean;
  debug?: boolean;
  noColor?: boolean;
}

interface ListPrsOptions {
  repo?: string;
  mine?: boolean;
  reviews?: boolean;
  open?: boolean;
  closed?: boolean;
  draft?: boolean;
  label?: string;
  since?: string;
  stale?: boolean;
  jsonl?: boolean;
  json?: boolean;
  debug?: boolean;
  noColor?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

async function createContext(
  options: { repo?: string; jsonl?: boolean; json?: boolean },
  config?: FirewatchConfig
): Promise<ListContext> {
  const loadedConfig = config ?? (await loadConfig());
  const repo = await resolveRepoOrThrow(options.repo);
  const { owner, name } = parseRepoInput(repo);

  const auth = await detectAuth(loadedConfig.github_token);
  const client = auth.isOk() ? new GitHubClient(auth.value.token) : null;

  return {
    client,
    config: loadedConfig,
    repo,
    owner,
    name,
    outputJson: shouldOutputJson(options, loadedConfig.output?.default_format),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Time filters
// ─────────────────────────────────────────────────────────────────────────────

interface FilterOptions {
  before?: string | undefined;
  since?: string | undefined;
}

function parseBeforeDate(before: string): Date {
  const date = new Date(before);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(
      `Invalid date format: ${before}. Use ISO format (e.g., 2024-01-15)`
    );
  }
  return date;
}

function applyTimeFilters(
  feedbacks: UnaddressedFeedback[],
  filters: FilterOptions
): UnaddressedFeedback[] {
  let filtered = feedbacks;

  if (filters.before) {
    const beforeDate = parseBeforeDate(filters.before);
    filtered = filtered.filter((fb) => new Date(fb.created_at) < beforeDate);
  }

  if (filters.since) {
    const sinceResult = parseSince(filters.since);
    if (sinceResult.isErr()) {
      console.error(sinceResult.error.message);
      process.exit(1);
    }
    filtered = filtered.filter(
      (fb) => new Date(fb.created_at) >= sinceResult.value
    );
  }

  return filtered;
}

// ─────────────────────────────────────────────────────────────────────────────
// Output formatting
// ─────────────────────────────────────────────────────────────────────────────

function formatFeedbackItemLine(fb: UnaddressedFeedback, repo: string): string {
  const shortId = generateShortId(fb.comment_id, repo);
  const location = fb.file ? `${fb.file}:${fb.line ?? "?"}` : "(comment)";
  const bodyPreview = fb.body
    ? truncate(fb.body.replaceAll("\n", " "), 60)
    : "";
  return formatFeedbackItem(
    formatDisplayId(shortId),
    fb.author,
    location,
    bodyPreview
  );
}

function printFeedbackSummary(
  pr: number,
  prTitle: string,
  feedbacks: UnaddressedFeedback[],
  repo: string
): void {
  const [header, divider] = formatPrFeedbackHeader(pr, prTitle);
  console.log(header);
  console.log(divider);

  if (feedbacks.length === 0) {
    console.error("No unaddressed feedback.");
    return;
  }

  for (const fb of feedbacks) {
    console.log("");
    console.log(formatFeedbackItemLine(fb, repo));
  }

  console.log("");
  console.log(`${feedbacks.length} need attention`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Stack handling
// ─────────────────────────────────────────────────────────────────────────────

function parseStackDirection(value: string | boolean): StackDirection {
  if (typeof value === "boolean" || value === "") {
    return "all";
  }
  const normalized = value.toLowerCase();
  if (normalized === "up" || normalized === "upstack") {
    return "up";
  }
  if (normalized === "down" || normalized === "downstack") {
    return "down";
  }
  return "all";
}

async function getStackFeedback(
  ctx: ListContext,
  direction: StackDirection,
  options: ListFeedbackOptions
): Promise<void> {
  const provider = await getStackProvider();
  if (!provider) {
    console.error("No stack provider available. Is Graphite installed?");
    process.exit(1);
  }

  const branch = await getCurrentBranch();
  if (!branch) {
    console.error(
      "Not in a git repository or could not detect current branch."
    );
    process.exit(1);
  }

  const stackPRs = await provider.getStackPRs(branch, direction);

  if (!stackPRs) {
    console.error(`Branch '${branch}' is not part of a tracked stack.`);
    process.exit(1);
  }

  if (stackPRs.prs.length === 0) {
    if (ctx.outputJson) {
      await outputStructured([], "jsonl");
    } else {
      console.error("No PRs with open pull requests in this stack.");
    }
    return;
  }

  const entries = await queryEntries({
    filters: {
      repo: ctx.repo,
      type: "comment",
      pr: stackPRs.prs,
      excludeStale: !options.stale,
    },
  });

  buildShortIdCache(entries);

  const ackedIds = await getAckedIds(ctx.repo);
  const feedbacks = identifyUnaddressedFeedback(entries, {
    ackedIds,
    username: ctx.config.user?.github_username,
    commitImpliesRead: ctx.config.feedback?.commit_implies_read,
  });

  if (ctx.outputJson) {
    for (const fb of feedbacks) {
      const shortId = formatDisplayId(generateShortId(fb.comment_id, ctx.repo));
      const { comment_id: gh_id, ...rest } = fb;
      await outputStructured({ ...rest, id: shortId, gh_id }, "jsonl");
    }
    return;
  }

  if (feedbacks.length === 0) {
    const directionLabels: Record<StackDirection, string> = {
      all: "stack",
      down: "downstack",
      up: "upstack",
    };
    console.error(`No unaddressed feedback in ${directionLabels[direction]}.`);
    return;
  }

  const byPr = new Map<number, UnaddressedFeedback[]>();
  for (const fb of feedbacks) {
    const list = byPr.get(fb.pr) ?? [];
    list.push(fb);
    byPr.set(fb.pr, list);
  }

  for (const prNum of stackPRs.prs) {
    const prFeedbacks = byPr.get(prNum);
    if (!prFeedbacks || prFeedbacks.length === 0) {
      continue;
    }
    const title = prFeedbacks[0]?.pr_title ?? "";
    const isCurrent = prNum === stackPRs.currentPr;
    const marker = isCurrent ? " <- current" : "";
    printFeedbackSummary(prNum, `${title}${marker}`, prFeedbacks, ctx.repo);
  }

  console.log(`\nTotal: ${feedbacks.length} items across ${byPr.size} PRs`);
}

// ─────────────────────────────────────────────────────────────────────────────
// List feedback handler
// ─────────────────────────────────────────────────────────────────────────────

async function handleListFeedback(options: ListFeedbackOptions): Promise<void> {
  applyCommonOptions(options);
  const ctx = await createContext(options);

  // Handle stack mode
  if (options.stack !== undefined) {
    const direction = parseStackDirection(options.stack);
    await getStackFeedback(ctx, direction, options);
    return;
  }

  // Handle PR-specific list
  if (options.pr) {
    const pr = Number.parseInt(options.pr, 10);
    if (Number.isNaN(pr)) {
      console.error(`Invalid PR number: ${options.pr}`);
      process.exit(1);
    }
    await handlePrFeedbackList(ctx, pr, options);
    return;
  }

  // Default: list all unaddressed feedback
  const entries = await queryEntries({
    filters: {
      repo: ctx.repo,
      type: "comment",
      excludeStale: !options.stale,
    },
  });

  buildShortIdCache(entries);

  const ackedIds = await getAckedIds(ctx.repo);
  let feedbacks = identifyUnaddressedFeedback(entries, {
    ackedIds,
    username: ctx.config.user?.github_username,
    commitImpliesRead: ctx.config.feedback?.commit_implies_read,
  });

  // Apply time filters
  feedbacks = applyTimeFilters(feedbacks, {
    before: options.before,
    since: options.since,
  });

  if (ctx.outputJson) {
    for (const fb of feedbacks) {
      const shortId = formatDisplayId(generateShortId(fb.comment_id, ctx.repo));
      const { comment_id: gh_id, ...rest } = fb;
      await outputStructured({ ...rest, id: shortId, gh_id }, "jsonl");
    }
    return;
  }

  if (feedbacks.length === 0) {
    console.error("No unaddressed feedback across repository.");
    return;
  }

  // Group by PR
  const byPr = new Map<number, UnaddressedFeedback[]>();
  for (const fb of feedbacks) {
    const list = byPr.get(fb.pr) ?? [];
    list.push(fb);
    byPr.set(fb.pr, list);
  }

  for (const [pr, prFeedbacks] of byPr) {
    const title = prFeedbacks[0]?.pr_title ?? "";
    printFeedbackSummary(pr, title, prFeedbacks, ctx.repo);
  }
}

async function handlePrFeedbackList(
  ctx: ListContext,
  pr: number,
  options: ListFeedbackOptions
): Promise<void> {
  const entries = await queryEntries({
    filters: {
      repo: ctx.repo,
      pr,
      excludeStale: !options.stale,
    },
  });

  buildShortIdCache(entries);

  if (options.all) {
    const comments = entries.filter((e) => e.type === "comment");
    if (ctx.outputJson) {
      for (const c of comments) {
        const shortId = formatDisplayId(generateShortId(c.id, ctx.repo));
        const { id: gh_id, ...rest } = c;
        await outputStructured({ ...rest, id: shortId, gh_id }, "jsonl");
      }
      return;
    }

    const prTitle = entries[0]?.pr_title ?? `PR #${pr}`;
    const [header, divider] = formatPrFeedbackHeader(pr, prTitle);
    console.log(header);
    console.log(divider);

    for (const c of comments) {
      const shortId = generateShortId(c.id, ctx.repo);
      const location = c.file ? `${c.file}:${c.line ?? "?"}` : "(comment)";
      const resolved = c.thread_resolved ? " [resolved]" : "";
      console.log(
        `\n${formatDisplayId(shortId)} @${c.author} ${location}${resolved}`
      );
      if (c.body) {
        console.log(`  "${truncate(c.body.replaceAll("\n", " "), 60)}"`);
      }
    }

    console.log(`\n${comments.length} total comments`);
    return;
  }

  const ackedIds = await getAckedIds(ctx.repo);
  const feedbacks = identifyUnaddressedFeedback(entries, {
    ackedIds,
    username: ctx.config.user?.github_username,
    commitImpliesRead: ctx.config.feedback?.commit_implies_read,
  });
  const prFeedbacks = feedbacks.filter((fb) => fb.pr === pr);

  if (ctx.outputJson) {
    for (const fb of prFeedbacks) {
      const shortId = formatDisplayId(generateShortId(fb.comment_id, ctx.repo));
      const { comment_id: gh_id, ...rest } = fb;
      await outputStructured({ ...rest, id: shortId, gh_id }, "jsonl");
    }
    return;
  }

  const prTitle = entries[0]?.pr_title ?? `PR #${pr}`;
  printFeedbackSummary(pr, prTitle, prFeedbacks, ctx.repo);
}

// ─────────────────────────────────────────────────────────────────────────────
// List PRs handler
// ─────────────────────────────────────────────────────────────────────────────

async function handleListPrs(options: ListPrsOptions): Promise<void> {
  applyCommonOptions(options);
  const ctx = await createContext(options);
  const username = ctx.config.user?.github_username;

  // Resolve states - use explicit booleans to satisfy exactOptionalPropertyTypes
  const states = resolveStates({
    open: options.open === true || (!options.closed && !options.draft),
    closed: options.closed === true,
    draft: options.draft === true,
  });

  // Query entries
  const filters: {
    repo: string;
    states?: PrState[];
    since?: Date;
    author?: string;
    excludeStale?: boolean;
  } = {
    repo: ctx.repo,
    states,
    excludeStale: !options.stale,
  };

  if (options.since) {
    const sinceResult = parseSince(options.since);
    if (sinceResult.isErr()) {
      console.error(sinceResult.error.message);
      process.exit(1);
    }
    filters.since = sinceResult.value;
  }

  if (options.mine && username) {
    filters.author = username;
  }

  const entries = await queryEntries({ filters });

  // Build unique PR list from entries
  interface PrSummary {
    pr: number;
    pr_title: string;
    pr_state: string;
    pr_author: string;
    pr_branch: string;
    pr_labels: string[];
    updated_at: string;
    url: string | undefined;
  }

  const prMap = new Map<number, PrSummary>();

  for (const entry of entries) {
    if (prMap.has(entry.pr)) {
      // Update with latest activity timestamp
      const existing = prMap.get(entry.pr)!;
      if (entry.created_at > existing.updated_at) {
        existing.updated_at = entry.created_at;
      }
    } else {
      prMap.set(entry.pr, {
        pr: entry.pr,
        pr_title: entry.pr_title,
        pr_state: entry.pr_state,
        pr_author: entry.pr_author,
        pr_branch: entry.pr_branch,
        pr_labels: entry.pr_labels ?? [],
        updated_at: entry.created_at,
        url: entry.url,
      });
    }
  }

  let prs = [...prMap.values()];

  // Filter by label if specified
  if (options.label) {
    const labelLower = options.label.toLowerCase();
    prs = prs.filter((pr) =>
      pr.pr_labels?.some((l) => l.toLowerCase().includes(labelLower))
    );
  }

  // Filter by reviews (PRs where user is reviewer, not author)
  if (options.reviews && username) {
    prs = prs.filter((pr) => pr.pr_author !== username);
  }

  // Sort by most recently updated
  prs.sort(
    (a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );

  if (ctx.outputJson) {
    for (const pr of prs) {
      await outputStructured(
        {
          repo: ctx.repo,
          ...pr,
        },
        "jsonl"
      );
    }
    return;
  }

  if (prs.length === 0) {
    console.error("No PRs found matching filters.");
    return;
  }

  console.log(`\n${s.bold("PRs")} ${s.dim(`(${ctx.repo})`)}`);
  console.log(SEPARATOR.primary.repeat(50));

  for (const pr of prs) {
    const stateLabel = formatState(pr.pr_state);
    const labels = pr.pr_labels?.length
      ? s.dim(` [${pr.pr_labels.join(", ")}]`)
      : "";
    console.log(
      `\n#${pr.pr} ${stateLabel} ${truncate(pr.pr_title, 40)}${labels}`
    );
    console.log(s.dim(`  @${pr.pr_author} ${pr.pr_branch}`));
  }

  console.log(`\n${prs.length} PRs`);
}

function formatState(state: string): string {
  switch (state) {
    case "open":
      return s.green("open");
    case "draft":
      return s.yellow("draft");
    case "closed":
      return s.red("closed");
    case "merged":
      return s.magenta("merged");
    default:
      return state;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Command definitions
// ─────────────────────────────────────────────────────────────────────────────

const feedbackSubcommand = new Command("feedback")
  .description("List feedback items needing attention")
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("--pr <number>", "Filter by PR number")
  .option("-s, --stack [direction]", "Filter to current stack (all, up, down)")
  .option("--all", "Include resolved feedback")
  .option("--since <duration>", "Comments within duration (e.g., 7d, 24h)")
  .option("--before <date>", "Comments before ISO date")
  .option("--open", "Only open PRs")
  .option("--closed", "Only closed PRs")
  .option("--state <states>", "Explicit state filter (comma-separated)")
  .option("--stale", "Include unresolved review comments on merged/closed PRs")
  .option("--long", "Detailed output")
  .option("--jsonl", "Force JSONL output")
  .option("--no-jsonl", "Force human-readable output")
  .addOption(new Option("--json").hideHelp())
  .option("--debug", "Enable debug logging")
  .option("--no-color", "Disable color output")
  .action(handleListFeedback);

const prsSubcommand = new Command("prs")
  .description("List pull requests")
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("--mine", "PRs authored by me")
  .option("--reviews", "PRs where I'm a reviewer")
  .option("--open", "Open PRs (default)")
  .option("--closed", "Closed/merged PRs")
  .option("--draft", "Draft PRs")
  .option("--stale", "Include unresolved review comments on merged/closed PRs")
  .option("--label <name>", "Filter by label (partial match)")
  .option("--since <duration>", "PRs updated within duration")
  .option("--jsonl", "Force JSONL output")
  .option("--no-jsonl", "Force human-readable output")
  .addOption(new Option("--json").hideHelp())
  .option("--debug", "Enable debug logging")
  .option("--no-color", "Disable color output")
  .action(handleListPrs);

export const listCommand = new Command("list")
  .description("List feedback or PRs (default: feedback)")
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("--pr <number>", "Filter by PR number")
  .option("-s, --stack [direction]", "Filter to current stack (all, up, down)")
  .option("--all", "Include resolved feedback")
  .option("--since <duration>", "Comments within duration (e.g., 7d, 24h)")
  .option("--before <date>", "Comments before ISO date")
  .option("--open", "Only open PRs")
  .option("--closed", "Only closed PRs")
  .option("--state <states>", "Explicit state filter (comma-separated)")
  .option("--stale", "Include unresolved review comments on merged/closed PRs")
  .option("--long", "Detailed output")
  .option("--jsonl", "Force JSONL output")
  .option("--no-jsonl", "Force human-readable output")
  .addOption(new Option("--json").hideHelp())
  .addCommand(feedbackSubcommand)
  .addCommand(prsSubcommand)
  .action(handleListFeedback);
