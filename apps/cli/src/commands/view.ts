/**
 * View command - polymorphic viewer for PRs and comments.
 *
 * Usage:
 *   fw view 42         - View PR #42 details
 *   fw view `@abc12`   - View comment by short ID
 *   fw view PRRC_...   - View by full ID
 */

import {
  GitHubClient,
  buildShortIdCache,
  classifyId,
  detectAuth,
  formatDisplayId,
  generateShortId,
  loadConfig,
  normalizeShortId,
  queryEntries,
  resolveBatchIds,
  resolveShortId,
  type FirewatchConfig,
  type FirewatchEntry,
} from "@outfitter/firewatch-core";
import { Command, Option } from "commander";

import { applyCommonOptions } from "../query-helpers";
import { SEPARATOR, s } from "../render";
import { parseRepoInput, resolveRepoOrThrow } from "../repo";
import { outputStructured } from "../utils/json";
import { shouldOutputJson, formatRelativeTime } from "../utils/tty";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ViewContext {
  client: GitHubClient | null;
  config: FirewatchConfig;
  repo: string;
  owner: string;
  name: string;
  outputJson: boolean;
}

interface ViewOptions {
  repo?: string;
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
): Promise<ViewContext> {
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
// ID Resolution
// ─────────────────────────────────────────────────────────────────────────────

interface ResolvedViewId {
  type: "pr" | "comment";
  pr?: number;
  commentId?: string;
  shortId?: string;
}

function resolveViewId(id: string, _repo: string): ResolvedViewId | null {
  const idType = classifyId(id);

  if (idType === "pr_number") {
    return {
      type: "pr",
      pr: Number.parseInt(id, 10),
    };
  }

  if (idType === "short_id") {
    // Normalize short ID to remove @ prefix for consistent handling
    const normalizedShortId = normalizeShortId(id);
    const mapping = resolveShortId(id);
    if (mapping) {
      return {
        type: "comment",
        commentId: mapping.fullId,
        shortId: normalizedShortId,
      };
    }
    // Will try async resolution
    return {
      type: "comment",
      shortId: normalizedShortId,
    };
  }

  if (idType === "full_id") {
    return {
      type: "comment",
      commentId: id,
    };
  }

  return null;
}

async function resolveShortIdAsync(
  shortId: string,
  repo: string
): Promise<string | null> {
  const [resolution] = await resolveBatchIds([shortId], repo);

  if (!resolution || resolution.type === "error") {
    return null;
  }

  if (resolution.type === "comment" && resolution.entry) {
    return resolution.entry.id;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// View handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleView(ids: string[], options: ViewOptions): Promise<void> {
  applyCommonOptions(options);
  if (ids.length === 0) {
    console.error("No ID provided. Usage: fw view <id>");
    console.error("  fw view 42       - View PR #42");
    console.error("  fw view @abc12   - View comment by short ID");
    console.error("  fw view PRRC_... - View comment by full ID");
    process.exit(1);
  }

  const ctx = await createContext(options);

  // Pre-populate cache for short ID resolution
  const entries = await queryEntries({
    filters: { repo: ctx.repo },
  });
  buildShortIdCache(entries);

  for (const id of ids) {
    let resolved = resolveViewId(id, ctx.repo);

    // Try async resolution for unresolved short IDs
    if (resolved?.type === "comment" && !resolved.commentId && resolved.shortId) {
      const fullId = await resolveShortIdAsync(resolved.shortId, ctx.repo);
      if (fullId) {
        resolved.commentId = fullId;
      } else {
        console.error(`Could not resolve short ID: ${resolved.shortId}`);
        continue;
      }
    }

    if (!resolved) {
      console.error(`Invalid ID format: ${id}`);
      continue;
    }

    if (resolved.type === "pr" && resolved.pr !== undefined) {
      await viewPr(ctx, resolved.pr, entries);
    } else if (resolved.type === "comment" && resolved.commentId) {
      await viewComment(ctx, resolved.commentId, resolved.shortId, entries);
    }
  }
}

async function viewPr(
  ctx: ViewContext,
  pr: number,
  allEntries: FirewatchEntry[]
): Promise<void> {
  // Filter entries for this PR
  const prEntries = allEntries.filter((e) => e.pr === pr);

  if (prEntries.length === 0) {
    console.error(`PR #${pr} not found in cache.`);
    return;
  }

  // Get PR metadata from first entry
  const entry = prEntries[0]!;
  const prData = {
    repo: ctx.repo,
    pr: entry.pr,
    title: entry.pr_title,
    state: entry.pr_state,
    author: entry.pr_author,
    branch: entry.pr_branch,
    labels: entry.pr_labels ?? [],
    url: entry.url,
  };

  // Count activity
  const commentCount = prEntries.filter((e) => e.type === "comment").length;
  const reviewCount = prEntries.filter((e) => e.type === "review").length;
  const commitCount = prEntries.filter((e) => e.type === "commit").length;

  // Get reviewers from review entries
  const reviewers = new Map<string, string>();
  for (const e of prEntries) {
    if (e.type === "review" && e.state) {
      reviewers.set(e.author, e.state.toLowerCase());
    }
  }

  if (ctx.outputJson) {
    await outputStructured(
      {
        ...prData,
        activity: {
          comments: commentCount,
          reviews: reviewCount,
          commits: commitCount,
        },
        reviewers: Object.fromEntries(reviewers),
      },
      "jsonl"
    );
    return;
  }

  // Human-readable output
  console.log("");
  console.log(s.bold(`PR #${pr}: ${prData.title}`));
  console.log(SEPARATOR.primary.repeat(50));

  // State and author
  const stateLabel = formatState(prData.state);
  console.log(`State: ${stateLabel}`);
  console.log(`Author: ${s.cyan(`@${prData.author}`)}`);
  console.log(`Branch: ${s.dim(prData.branch)} -> main`);

  // Labels
  if (prData.labels.length > 0) {
    console.log(`Labels: ${prData.labels.map((l) => s.yellow(l)).join(", ")}`);
  }

  // Reviewers
  if (reviewers.size > 0) {
    const reviewerList = [...reviewers.entries()]
      .map(([name, state]) => `${name} (${formatReviewState(state)})`)
      .join(", ");
    console.log(`Reviewers: ${reviewerList}`);
  }

  // Activity summary
  console.log("");
  const activityParts = [];
  if (commentCount > 0) {
    activityParts.push(`${commentCount} comments`);
  }
  if (reviewCount > 0) {
    activityParts.push(`${reviewCount} reviews`);
  }
  if (commitCount > 0) {
    activityParts.push(`${commitCount} commits`);
  }
  console.log(`Activity: ${activityParts.join(", ") || "none"}`);

  if (prData.url) {
    console.log("");
    console.log(s.dim(prData.url));
  }
}

async function viewComment(
  ctx: ViewContext,
  commentId: string,
  shortId: string | undefined,
  allEntries: FirewatchEntry[]
): Promise<void> {
  // Find the comment entry
  const entry = allEntries.find((e) => e.id === commentId);

  if (!entry) {
    const displayId = shortId ? formatDisplayId(shortId) : commentId;
    console.error(`Comment ${displayId} not found.`);
    return;
  }

  const sId = shortId ?? generateShortId(entry.id, ctx.repo);

  if (ctx.outputJson) {
    const { id: gh_id, ...rest } = entry;
    await outputStructured(
      { ...rest, id: formatDisplayId(sId), gh_id },
      "jsonl"
    );
    return;
  }

  // Human-readable output
  console.log("");

  // Header with short ID, type, and author
  const typeLabel =
    entry.subtype === "review_comment" ? "Review comment" : "Comment";
  console.log(
    s.bold(`${formatDisplayId(sId)} ${typeLabel} by @${entry.author}`)
  );
  console.log(`PR #${entry.pr}: ${entry.pr_title}`);

  // File location for review comments
  if (entry.file) {
    const lineInfo = entry.line ? `:${entry.line}` : "";
    console.log(`File: ${s.cyan(entry.file + lineInfo)}`);

    // Show code context if available (simulated - actual code would need API)
    if (entry.line) {
      console.log("");
      const lineNum = entry.line;
      console.log(s.dim(`  ${lineNum - 1} |`));
      console.log(`${s.yellow(">")} ${lineNum} | ${s.dim("[code context]")}`);
      console.log(s.dim(`  ${lineNum + 1} |`));
    }
  }

  // Comment body
  console.log("");
  console.log("Comment:");
  if (entry.body) {
    const lines = entry.body.split("\n");
    for (const line of lines.slice(0, 10)) {
      console.log(`  ${line}`);
    }
    if (lines.length > 10) {
      console.log(s.dim(`  ... (${lines.length - 10} more lines)`));
    }
  } else {
    console.log(s.dim("  (no body)"));
  }

  // Thread status for review comments
  if (entry.subtype === "review_comment") {
    const resolved = entry.thread_resolved;
    let statusLabel: string;
    if (resolved === true) {
      statusLabel = s.green("resolved");
    } else if (resolved === false) {
      statusLabel = s.yellow("unresolved");
    } else {
      statusLabel = s.dim("unknown");
    }
    console.log("");
    console.log(`Thread: ${statusLabel}`);
  }

  // Timestamp
  console.log("");
  console.log(s.dim(`Created: ${formatRelativeTime(entry.created_at)}`));

  if (entry.url) {
    console.log(s.dim(entry.url));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────────

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

function formatReviewState(state: string): string {
  switch (state.toLowerCase()) {
    case "approved":
      return s.green("approved");
    case "changes_requested":
      return s.red("changes requested");
    case "commented":
      return s.blue("commented");
    case "pending":
      return s.dim("pending");
    default:
      return state;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Command definition
// ─────────────────────────────────────────────────────────────────────────────

export const viewCommand = new Command("view")
  .description("View PR or comment details")
  .argument("<ids...>", "PR number, @shortId, or full comment ID")
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("--jsonl", "Force JSONL output")
  .option("--no-jsonl", "Force human-readable output")
  .addOption(new Option("--json").hideHelp())
  .option("--debug", "Enable debug logging")
  .option("--no-color", "Disable color output")
  .action(handleView);
