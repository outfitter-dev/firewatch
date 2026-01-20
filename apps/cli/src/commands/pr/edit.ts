import {
  GitHubClient,
  detectAuth,
  loadConfig,
} from "@outfitter/firewatch-core";
import { Command } from "commander";

import { parseRepoInput, parsePrNumber, resolveRepoOrThrow } from "../../repo";
import { outputStructured } from "../../utils/json";
import { shouldOutputJson } from "../../utils/tty";

interface EditCommandOptions {
  repo?: string;
  title?: string;
  body?: string;
  base?: string;
  milestone?: string;
  removeMilestone?: boolean;
  draft?: boolean;
  ready?: boolean;
  addLabel?: string[];
  removeLabel?: string[];
  addReviewer?: string[];
  removeReviewer?: string[];
  addAssignee?: string[];
  removeAssignee?: string[];
  jsonl?: boolean;
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

interface EditContext {
  client: GitHubClient;
  owner: string;
  name: string;
  repo: string;
  pr: number;
  outputJson: boolean;
}

interface EditResult {
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

async function applyFieldEdits(
  ctx: EditContext,
  options: EditCommandOptions
): Promise<Partial<EditResult>> {
  const changes: Partial<EditResult> = {};

  if (options.title || options.body || options.base) {
    await ctx.client.editPullRequest(ctx.owner, ctx.name, ctx.pr, {
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
  options: EditCommandOptions
): Promise<Partial<EditResult>> {
  const changes: Partial<EditResult> = {};

  if (options.milestone) {
    await ctx.client.setMilestone(
      ctx.owner,
      ctx.name,
      ctx.pr,
      options.milestone
    );
    changes.milestone = options.milestone;
  }

  if (options.removeMilestone) {
    await ctx.client.clearMilestone(ctx.owner, ctx.name, ctx.pr);
    changes.milestone_cleared = true;
  }

  return changes;
}

async function applyDraftState(
  ctx: EditContext,
  options: EditCommandOptions
): Promise<Partial<EditResult>> {
  const changes: Partial<EditResult> = {};

  if (options.draft || options.ready) {
    const prId = await ctx.client.fetchPullRequestId(
      ctx.owner,
      ctx.name,
      ctx.pr
    );

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
  options: EditCommandOptions
): Promise<Partial<EditResult>> {
  const changes: Partial<EditResult> = {};
  const addLabels = options.addLabel ?? [];
  const removeLabels = options.removeLabel ?? [];

  if (addLabels.length > 0) {
    await ctx.client.addLabels(ctx.owner, ctx.name, ctx.pr, addLabels);
    changes.labels_added = addLabels;
  }

  if (removeLabels.length > 0) {
    await ctx.client.removeLabels(ctx.owner, ctx.name, ctx.pr, removeLabels);
    changes.labels_removed = removeLabels;
  }

  return changes;
}

async function applyReviewerEdits(
  ctx: EditContext,
  options: EditCommandOptions
): Promise<Partial<EditResult>> {
  const changes: Partial<EditResult> = {};
  const addReviewers = options.addReviewer ?? [];
  const removeReviewers = options.removeReviewer ?? [];

  if (addReviewers.length > 0) {
    await ctx.client.requestReviewers(
      ctx.owner,
      ctx.name,
      ctx.pr,
      addReviewers
    );
    changes.reviewers_added = addReviewers;
  }

  if (removeReviewers.length > 0) {
    await ctx.client.removeReviewers(
      ctx.owner,
      ctx.name,
      ctx.pr,
      removeReviewers
    );
    changes.reviewers_removed = removeReviewers;
  }

  return changes;
}

async function applyAssigneeEdits(
  ctx: EditContext,
  options: EditCommandOptions
): Promise<Partial<EditResult>> {
  const changes: Partial<EditResult> = {};
  const addAssignees = options.addAssignee ?? [];
  const removeAssignees = options.removeAssignee ?? [];

  if (addAssignees.length > 0) {
    await ctx.client.addAssignees(ctx.owner, ctx.name, ctx.pr, addAssignees);
    changes.assignees_added = addAssignees;
  }

  if (removeAssignees.length > 0) {
    await ctx.client.removeAssignees(
      ctx.owner,
      ctx.name,
      ctx.pr,
      removeAssignees
    );
    changes.assignees_removed = removeAssignees;
  }

  return changes;
}

function hasAnyEdit(options: EditCommandOptions): boolean {
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

function formatHumanOutput(result: EditResult): string {
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

export const editCommand = new Command("edit")
  .description("Edit PR fields, labels, reviewers, assignees (gh-aligned)")
  .argument("<pr>", "PR number", parsePrNumber)
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("--title <text>", "Change PR title")
  .option("--body <text>", "Change PR description")
  .option("--base <branch>", "Change base branch")
  .option("--milestone <name>", "Set milestone by name")
  .option("--remove-milestone", "Clear milestone")
  .option("--draft", "Convert to draft")
  .option("--ready", "Mark ready for review")
  .option("--add-label <name>", "Add label (repeatable)", collect)
  .option("--remove-label <name>", "Remove label (repeatable)", collect)
  .option("--add-reviewer <user>", "Add reviewer (repeatable)", collect)
  .option("--remove-reviewer <user>", "Remove reviewer (repeatable)", collect)
  .option("--add-assignee <user>", "Add assignee (repeatable)", collect)
  .option("--remove-assignee <user>", "Remove assignee (repeatable)", collect)
  .option("--jsonl", "Force structured output")
  .option("--no-jsonl", "Force human-readable output")
  .action(async (pr: number, options: EditCommandOptions) => {
    try {
      // Validate conflicting options
      if (options.draft && options.ready) {
        console.error("Cannot use --draft and --ready together.");
        process.exit(1);
      }

      if (options.milestone && options.removeMilestone) {
        console.error(
          "Cannot use --milestone and --remove-milestone together."
        );
        process.exit(1);
      }

      if (!hasAnyEdit(options)) {
        console.error(
          "No edits specified. Use --help to see available options."
        );
        process.exit(1);
      }

      const config = await loadConfig();
      const repo = await resolveRepoOrThrow(options.repo);
      const { owner, name } = parseRepoInput(repo);

      const auth = await detectAuth(config.github_token);
      if (!auth.token) {
        console.error(auth.error);
        process.exit(1);
      }

      const ctx: EditContext = {
        client: new GitHubClient(auth.token),
        owner,
        name,
        repo,
        pr,
        outputJson: shouldOutputJson(options, config.output?.default_format),
      };

      // Apply all edits and collect results
      const fieldChanges = await applyFieldEdits(ctx, options);
      const milestoneChanges = await applyMilestoneEdits(ctx, options);
      const draftChanges = await applyDraftState(ctx, options);
      const labelChanges = await applyLabelEdits(ctx, options);
      const reviewerChanges = await applyReviewerEdits(ctx, options);
      const assigneeChanges = await applyAssigneeEdits(ctx, options);

      const result: EditResult = {
        ok: true,
        repo,
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
        console.log(formatHumanOutput(result));
      }
    } catch (error) {
      console.error(
        "Edit failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
