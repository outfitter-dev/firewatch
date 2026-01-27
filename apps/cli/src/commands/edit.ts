/**
 * Polymorphic edit command for PRs and comments.
 *
 * ID Resolution:
 * - `42` -> PR #42 (PR editing mode)
 * - `@abc12` -> Comment with short ID (Comment editing mode)
 * - `PRRC_...`, `IC_...` -> Comment by full ID (Comment editing mode)
 */
import {
  GitHubClient,
  buildShortIdCache,
  detectAuth,
  formatDisplayId,
  generateShortId,
  loadConfig,
  queryEntries,
  resolveBatchIds,
  type FirewatchConfig,
  type FirewatchEntry,
} from "@outfitter/firewatch-core";
import { Command, Option } from "commander";

import { applyCommonOptions } from "../query-helpers";
import { parseRepoInput, resolveRepoOrThrow } from "../repo";
import { outputStructured } from "../utils/json";
import { shouldOutputJson } from "../utils/tty";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface EditOptions {
  repo?: string;
  // PR options
  title?: string;
  body?: string;
  base?: string;
  draft?: boolean;
  ready?: boolean;
  addLabel?: string[];
  removeLabel?: string[];
  addReviewer?: string[];
  removeReviewer?: string[];
  addAssignee?: string[];
  removeAssignee?: string[];
  milestone?: string;
  removeMilestone?: boolean;
  // Comment options
  delete?: boolean;
  yes?: boolean;
  // Output
  jsonl?: boolean;
  json?: boolean;
  // Common options
  debug?: boolean;
  noColor?: boolean;
}

interface EditContext {
  client: GitHubClient;
  config: FirewatchConfig;
  repo: string;
  owner: string;
  name: string;
  outputJson: boolean;
}

interface PrEditResult {
  ok: boolean;
  repo: string;
  pr: number;
  title?: string;
  body?: string;
  base?: string;
  milestone?: string;
  milestone_cleared?: boolean;
  draft?: boolean;
  ready?: boolean;
  labels_added?: string[];
  labels_removed?: string[];
  reviewers_added?: string[];
  reviewers_removed?: string[];
  assignees_added?: string[];
  assignees_removed?: string[];
}

interface CommentEditResult {
  ok: boolean;
  repo: string;
  id: string;
  gh_id: string;
  action: "updated" | "deleted";
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

async function createContext(options: EditOptions): Promise<EditContext> {
  const config = await loadConfig();
  const repo = await resolveRepoOrThrow(options.repo);
  const { owner, name } = parseRepoInput(repo);

  const auth = await detectAuth(config.github_token);
  if (!auth.token) {
    throw new Error(auth.error ?? "No GitHub token available");
  }

  return {
    client: new GitHubClient(auth.token),
    config,
    repo,
    owner,
    name,
    outputJson: shouldOutputJson(options, config.output?.default_format),
  };
}

function isPrNumber(id: string): boolean {
  return /^\d+$/.test(id.trim());
}

async function confirmDelete(shortId: string): Promise<boolean> {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    const answer = await rl.question(
      `Are you sure you want to delete comment ${shortId}? (y/N) `
    );
    return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

/**
 * Legacy fallback: Extract REST API numeric ID from GraphQL node ID.
 * GitHub node IDs contain the numeric ID at the end after base64 decoding.
 *
 * Note: This is fragile - prefer using stored database_id when available.
 */
function extractRestIdLegacy(graphqlId: string): number | null {
  try {
    // GitHub node IDs are base64 encoded
    const decoded = Buffer.from(graphqlId, "base64").toString("utf8");
    // Format is typically like "05:IssueComment12345" or similar.
    const matches = decoded.match(/\d+/g);
    const last = matches?.at(-1);
    if (last) {
      return Number.parseInt(last, 10);
    }
  } catch {
    // Not a valid base64 string
  }
  return null;
}

/**
 * Get REST API numeric ID for a comment entry.
 * Prefers stored database_id (reliable), falls back to base64 extraction (legacy).
 */
function getRestId(entry: FirewatchEntry): number | null {
  // Prefer stored database_id (synced from GitHub API)
  if (entry.database_id) {
    return entry.database_id;
  }
  // Fall back to base64 decoding for legacy cache entries
  return extractRestIdLegacy(entry.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// PR Editing
// ─────────────────────────────────────────────────────────────────────────────

function hasPrEdits(options: EditOptions): boolean {
  return Boolean(
    options.title ||
      options.body ||
      options.base ||
      options.milestone ||
      options.removeMilestone ||
      options.draft ||
      options.ready ||
      (options.addLabel && options.addLabel.length > 0) ||
      (options.removeLabel && options.removeLabel.length > 0) ||
      (options.addReviewer && options.addReviewer.length > 0) ||
      (options.removeReviewer && options.removeReviewer.length > 0) ||
      (options.addAssignee && options.addAssignee.length > 0) ||
      (options.removeAssignee && options.removeAssignee.length > 0)
  );
}

async function applyFieldEdits(
  ctx: EditContext,
  pr: number,
  options: EditOptions
): Promise<Partial<PrEditResult>> {
  const changes: Partial<PrEditResult> = {};

  if (options.title || options.body || options.base) {
    await ctx.client.editPullRequest(ctx.owner, ctx.name, pr, {
      ...(options.title && { title: options.title }),
      ...(options.body && { body: options.body }),
      ...(options.base && { base: options.base }),
    });

    if (options.title) {
      changes.title = options.title;
    }
    if (options.body) {
      changes.body = options.body;
    }
    if (options.base) {
      changes.base = options.base;
    }
  }

  return changes;
}

async function applyMilestoneEdits(
  ctx: EditContext,
  pr: number,
  options: EditOptions
): Promise<Partial<PrEditResult>> {
  const changes: Partial<PrEditResult> = {};

  if (options.milestone) {
    await ctx.client.setMilestone(ctx.owner, ctx.name, pr, options.milestone);
    changes.milestone = options.milestone;
  }

  if (options.removeMilestone) {
    await ctx.client.clearMilestone(ctx.owner, ctx.name, pr);
    changes.milestone_cleared = true;
  }

  return changes;
}

async function applyDraftState(
  ctx: EditContext,
  pr: number,
  options: EditOptions
): Promise<Partial<PrEditResult>> {
  const changes: Partial<PrEditResult> = {};

  if (options.draft || options.ready) {
    const prId = await ctx.client.fetchPullRequestId(ctx.owner, ctx.name, pr);

    if (options.draft) {
      await ctx.client.convertPullRequestToDraft(prId);
      changes.draft = true;
    }

    if (options.ready) {
      await ctx.client.markPullRequestReady(prId);
      changes.ready = true;
    }
  }

  return changes;
}

async function applyLabelEdits(
  ctx: EditContext,
  pr: number,
  options: EditOptions
): Promise<Partial<PrEditResult>> {
  const changes: Partial<PrEditResult> = {};
  const addLabels = options.addLabel ?? [];
  const removeLabels = options.removeLabel ?? [];

  if (addLabels.length > 0) {
    await ctx.client.addLabels(ctx.owner, ctx.name, pr, addLabels);
    changes.labels_added = addLabels;
  }

  if (removeLabels.length > 0) {
    await ctx.client.removeLabels(ctx.owner, ctx.name, pr, removeLabels);
    changes.labels_removed = removeLabels;
  }

  return changes;
}

async function applyReviewerEdits(
  ctx: EditContext,
  pr: number,
  options: EditOptions
): Promise<Partial<PrEditResult>> {
  const changes: Partial<PrEditResult> = {};
  const addReviewers = options.addReviewer ?? [];
  const removeReviewers = options.removeReviewer ?? [];

  if (addReviewers.length > 0) {
    await ctx.client.requestReviewers(ctx.owner, ctx.name, pr, addReviewers);
    changes.reviewers_added = addReviewers;
  }

  if (removeReviewers.length > 0) {
    await ctx.client.removeReviewers(ctx.owner, ctx.name, pr, removeReviewers);
    changes.reviewers_removed = removeReviewers;
  }

  return changes;
}

async function applyAssigneeEdits(
  ctx: EditContext,
  pr: number,
  options: EditOptions
): Promise<Partial<PrEditResult>> {
  const changes: Partial<PrEditResult> = {};
  const addAssignees = options.addAssignee ?? [];
  const removeAssignees = options.removeAssignee ?? [];

  if (addAssignees.length > 0) {
    await ctx.client.addAssignees(ctx.owner, ctx.name, pr, addAssignees);
    changes.assignees_added = addAssignees;
  }

  if (removeAssignees.length > 0) {
    await ctx.client.removeAssignees(ctx.owner, ctx.name, pr, removeAssignees);
    changes.assignees_removed = removeAssignees;
  }

  return changes;
}

function formatPrHumanOutput(result: PrEditResult): string {
  const parts: string[] = [];

  if (result.title) {
    parts.push(`title: "${result.title}"`);
  }
  if (result.body) {
    parts.push("body updated");
  }
  if (result.base) {
    parts.push(`base: ${result.base}`);
  }
  if (result.milestone) {
    parts.push(`milestone: ${result.milestone}`);
  }
  if (result.milestone_cleared) {
    parts.push("milestone cleared");
  }
  if (result.draft) {
    parts.push("converted to draft");
  }
  if (result.ready) {
    parts.push("marked ready");
  }
  if (result.labels_added) {
    parts.push(`labels +${result.labels_added.join(", +")}`);
  }
  if (result.labels_removed) {
    parts.push(`labels -${result.labels_removed.join(", -")}`);
  }
  if (result.reviewers_added) {
    parts.push(`reviewers +${result.reviewers_added.join(", +")}`);
  }
  if (result.reviewers_removed) {
    parts.push(`reviewers -${result.reviewers_removed.join(", -")}`);
  }
  if (result.assignees_added) {
    parts.push(`assignees +${result.assignees_added.join(", +")}`);
  }
  if (result.assignees_removed) {
    parts.push(`assignees -${result.assignees_removed.join(", -")}`);
  }

  if (parts.length === 0) {
    return `Updated ${result.repo}#${result.pr}.`;
  }

  return `Updated ${result.repo}#${result.pr}: ${parts.join(", ")}.`;
}

async function handlePrEdit(
  ctx: EditContext,
  pr: number,
  options: EditOptions
): Promise<void> {
  // Validate conflicting options
  if (options.draft && options.ready) {
    console.error("Cannot use --draft and --ready together.");
    process.exit(1);
  }

  if (options.milestone && options.removeMilestone) {
    console.error("Cannot use --milestone and --remove-milestone together.");
    process.exit(1);
  }

  if (!hasPrEdits(options)) {
    console.error("No edits specified. Use --help to see available options.");
    process.exit(1);
  }

  // Apply all edits and collect results
  const fieldChanges = await applyFieldEdits(ctx, pr, options);
  const milestoneChanges = await applyMilestoneEdits(ctx, pr, options);
  const draftChanges = await applyDraftState(ctx, pr, options);
  const labelChanges = await applyLabelEdits(ctx, pr, options);
  const reviewerChanges = await applyReviewerEdits(ctx, pr, options);
  const assigneeChanges = await applyAssigneeEdits(ctx, pr, options);

  const result: PrEditResult = {
    ok: true,
    repo: ctx.repo,
    pr,
    ...fieldChanges,
    ...milestoneChanges,
    ...draftChanges,
    ...labelChanges,
    ...reviewerChanges,
    ...assigneeChanges,
  };

  if (ctx.outputJson) {
    await outputStructured(result, "jsonl");
  } else {
    console.log(formatPrHumanOutput(result));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Comment Editing
// ─────────────────────────────────────────────────────────────────────────────

function hasCommentEdits(options: EditOptions): boolean {
  return Boolean(options.body || options.delete);
}

async function resolveCommentEntry(
  ctx: EditContext,
  idArg: string
): Promise<{ entry: FirewatchEntry; shortId: string } | null> {
  // Pre-populate cache for short ID resolution
  const entries = await queryEntries({
    filters: { repo: ctx.repo, type: "comment" },
  });
  buildShortIdCache(entries);

  const [resolution] = await resolveBatchIds([idArg], ctx.repo);

  if (!resolution || resolution.type === "error") {
    console.error(
      `Could not resolve ID "${idArg}": ${resolution?.error ?? "Unknown error"}`
    );
    return null;
  }

  if (resolution.type === "pr") {
    // Should not happen since we already checked for PR numbers
    console.error(`Expected comment ID, got PR number: ${idArg}`);
    return null;
  }

  if (!resolution.entry) {
    console.error(`Comment not found in cache: ${idArg}`);
    return null;
  }

  const shortId =
    resolution.shortId ?? generateShortId(resolution.entry.id, ctx.repo);

  return { entry: resolution.entry, shortId };
}

async function handleCommentEdit(
  ctx: EditContext,
  idArg: string,
  options: EditOptions
): Promise<void> {
  if (!hasCommentEdits(options)) {
    console.error(
      "No edits specified. Use --body <text> or --delete for comments."
    );
    process.exit(1);
  }

  const resolved = await resolveCommentEntry(ctx, idArg);
  if (!resolved) {
    process.exit(1);
  }

  const { entry, shortId } = resolved;
  const displayId = formatDisplayId(shortId);

  // Handle delete
  if (options.delete) {
    await handleCommentDelete(ctx, entry, displayId, options);
    return;
  }

  // Handle body update
  if (options.body) {
    await handleCommentBodyUpdate(ctx, entry, displayId, options.body);
  }
}

async function handleCommentDelete(
  ctx: EditContext,
  entry: FirewatchEntry,
  displayId: string,
  options: EditOptions
): Promise<void> {
  // Confirmation required unless --yes is provided
  if (!options.yes && !ctx.outputJson) {
    const confirmed = await confirmDelete(displayId);
    if (!confirmed) {
      console.log("Delete cancelled.");
      return;
    }
  }

  const restId = getRestId(entry);
  if (!restId) {
    const result: CommentEditResult = {
      ok: false,
      repo: ctx.repo,
      id: displayId,
      gh_id: entry.id,
      action: "deleted",
      error: "Could not extract REST API ID from comment",
    };
    if (ctx.outputJson) {
      await outputStructured(result, "jsonl");
    } else {
      console.error(`Failed to delete comment ${displayId}: ${result.error}`);
    }
    process.exit(1);
  }

  try {
    if (entry.subtype === "review_comment") {
      await ctx.client.deleteReviewComment(ctx.owner, ctx.name, restId);
    } else {
      await ctx.client.deleteIssueComment(ctx.owner, ctx.name, restId);
    }

    const result: CommentEditResult = {
      ok: true,
      repo: ctx.repo,
      id: displayId,
      gh_id: entry.id,
      action: "deleted",
    };

    if (ctx.outputJson) {
      await outputStructured(result, "jsonl");
    } else {
      console.log(`Deleted comment ${displayId}.`);
    }
  } catch (error) {
    const result: CommentEditResult = {
      ok: false,
      repo: ctx.repo,
      id: displayId,
      gh_id: entry.id,
      action: "deleted",
      error: error instanceof Error ? error.message : String(error),
    };

    if (ctx.outputJson) {
      await outputStructured(result, "jsonl");
    } else {
      console.error(`Failed to delete comment ${displayId}: ${result.error}`);
    }
    process.exit(1);
  }
}

async function handleCommentBodyUpdate(
  ctx: EditContext,
  entry: FirewatchEntry,
  displayId: string,
  body: string
): Promise<void> {
  const restId = getRestId(entry);
  if (!restId) {
    const result: CommentEditResult = {
      ok: false,
      repo: ctx.repo,
      id: displayId,
      gh_id: entry.id,
      action: "updated",
      error: "Could not extract REST API ID from comment",
    };
    if (ctx.outputJson) {
      await outputStructured(result, "jsonl");
    } else {
      console.error(`Failed to update comment ${displayId}: ${result.error}`);
    }
    process.exit(1);
  }

  try {
    if (entry.subtype === "review_comment") {
      await ctx.client.editReviewComment(ctx.owner, ctx.name, restId, body);
    } else {
      await ctx.client.editIssueComment(ctx.owner, ctx.name, restId, body);
    }

    const result: CommentEditResult = {
      ok: true,
      repo: ctx.repo,
      id: displayId,
      gh_id: entry.id,
      action: "updated",
    };

    if (ctx.outputJson) {
      await outputStructured(result, "jsonl");
    } else {
      console.log(`Updated comment ${displayId}.`);
    }
  } catch (error) {
    const result: CommentEditResult = {
      ok: false,
      repo: ctx.repo,
      id: displayId,
      gh_id: entry.id,
      action: "updated",
      error: error instanceof Error ? error.message : String(error),
    };

    if (ctx.outputJson) {
      await outputStructured(result, "jsonl");
    } else {
      console.error(`Failed to update comment ${displayId}: ${result.error}`);
    }
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Handler
// ─────────────────────────────────────────────────────────────────────────────

async function handleEdit(idArg: string, options: EditOptions): Promise<void> {
  applyCommonOptions(options);
  try {
    const ctx = await createContext(options);

    if (isPrNumber(idArg)) {
      // PR editing mode
      const pr = Number.parseInt(idArg, 10);
      await handlePrEdit(ctx, pr, options);
    } else {
      // Comment editing mode
      await handleCommentEdit(ctx, idArg, options);
    }
  } catch (error) {
    console.error(
      "Edit failed:",
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Command Definition
// ─────────────────────────────────────────────────────────────────────────────

export const editCommand = new Command("edit")
  .description("Edit PRs or comments (polymorphic: ID type determines mode)")
  .argument("<id>", "PR number (42) or comment ID (@abc12, PRRC_..., IC_...)")
  .option("--repo <name>", "Repository (owner/repo format)")
  // PR options
  .option("--title <text>", "Change PR title")
  .option("--body <text>", "Change PR description or comment body")
  .option("--base <branch>", "Change base branch (PR only)")
  .option("--milestone <name>", "Set milestone by name (PR only)")
  .option("--remove-milestone", "Clear milestone (PR only)")
  .option("--draft", "Convert to draft (PR only)")
  .option("--ready", "Mark ready for review (PR only)")
  .option("--add-label <name>", "Add label (PR only, repeatable)", collect)
  .option("--remove-label <name>", "Remove label (PR only, repeatable)", collect)
  .option(
    "--add-reviewer <user>",
    "Add reviewer (PR only, repeatable)",
    collect
  )
  .option(
    "--remove-reviewer <user>",
    "Remove reviewer (PR only, repeatable)",
    collect
  )
  .option(
    "--add-assignee <user>",
    "Add assignee (PR only, repeatable)",
    collect
  )
  .option(
    "--remove-assignee <user>",
    "Remove assignee (PR only, repeatable)",
    collect
  )
  // Comment options
  .option("--delete", "Delete the comment (comment only)")
  .option("-y, --yes", "Skip confirmation for delete")
  // Output
  .option("--jsonl", "Force structured output")
  .option("--no-jsonl", "Force human-readable output")
  .addOption(new Option("--json").hideHelp())
  .option("--debug", "Enable debug logging")
  .option("--no-color", "Disable color output")
  .addHelpText(
    "after",
    `
Examples:
  fw edit 42 --title "feat: new title"     Edit PR title
  fw edit 42 --draft                       Convert PR to draft
  fw edit 42 --ready                       Mark PR ready for review
  fw edit 42 --add-label bug               Add label to PR
  fw edit @abc12 --body "Updated text"     Edit comment body
  fw edit @abc12 --delete                  Delete comment (with confirm)
  fw edit @abc12 --delete --yes            Delete comment (no confirm)`
  )
  .action(handleEdit);
