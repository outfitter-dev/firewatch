import {
  GitHubClient,
  detectAuth,
  loadConfig,
} from "@outfitter/firewatch-core";
import { Command } from "commander";

import { parseRepoInput, parsePrNumber, resolveRepoOrThrow } from "../repo";
import { writeJsonLine } from "../utils/json";
import { shouldOutputJson } from "../utils/tty";

type ReviewEvent = "approve" | "request-changes" | "comment";

interface AddCommandOptions {
  repo?: string;
  reply?: string;
  resolve?: boolean;
  review?: ReviewEvent;
  label?: string[];
  reviewer?: string[];
  assignee?: string[];
  json?: boolean;
}

interface AddContext {
  client: GitHubClient;
  owner: string;
  name: string;
  repo: string;
  pr: number;
  outputJson: boolean;
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function normalizeReviewEvent(value: string): ReviewEvent {
  const normalized = value.toLowerCase();
  if (
    normalized !== "approve" &&
    normalized !== "request-changes" &&
    normalized !== "comment"
  ) {
    throw new Error(
      `Invalid review type: ${value}. Use approve, request-changes, or comment.`
    );
  }
  return normalized as ReviewEvent;
}

async function handleReviewAction(
  ctx: AddContext,
  reviewType: string,
  body: string | undefined
): Promise<void> {
  const event = normalizeReviewEvent(reviewType);
  const review = await ctx.client.addReview(
    ctx.owner,
    ctx.name,
    ctx.pr,
    event,
    body
  );
  const payload = {
    ok: true,
    repo: ctx.repo,
    pr: ctx.pr,
    review: event,
    ...(review?.id && { review_id: review.id }),
    ...(review?.url && { url: review.url }),
  };

  if (ctx.outputJson) {
    await writeJsonLine(payload);
  } else {
    console.log(`Added ${event} review on ${ctx.repo}#${ctx.pr}.`);
  }
}

async function handleMetadataAction(
  ctx: AddContext,
  labels: string[],
  reviewers: string[],
  assignees: string[]
): Promise<void> {
  if (labels.length > 0) {
    await ctx.client.addLabels(ctx.owner, ctx.name, ctx.pr, labels);
  }
  if (reviewers.length > 0) {
    await ctx.client.requestReviewers(ctx.owner, ctx.name, ctx.pr, reviewers);
  }
  if (assignees.length > 0) {
    await ctx.client.addAssignees(ctx.owner, ctx.name, ctx.pr, assignees);
  }

  const payload = {
    ok: true,
    repo: ctx.repo,
    pr: ctx.pr,
    ...(labels.length > 0 && { labels_added: labels }),
    ...(reviewers.length > 0 && { reviewers_added: reviewers }),
    ...(assignees.length > 0 && { assignees_added: assignees }),
  };

  if (ctx.outputJson) {
    await writeJsonLine(payload);
  } else {
    console.log(`Updated ${ctx.repo}#${ctx.pr}.`);
  }
}

async function handleReplyAction(
  ctx: AddContext,
  replyTo: string,
  body: string,
  resolve: boolean
): Promise<void> {
  const threadMap = await ctx.client.fetchReviewThreadMap(
    ctx.owner,
    ctx.name,
    ctx.pr
  );
  const threadId = threadMap.get(replyTo);
  if (!threadId) {
    console.error(`No review thread found for comment ${replyTo}.`);
    process.exit(1);
  }

  const reply = await ctx.client.addReviewThreadReply(threadId, body);
  if (resolve) {
    await ctx.client.resolveReviewThread(threadId);
  }

  const payload = {
    ok: true,
    repo: ctx.repo,
    pr: ctx.pr,
    comment_id: reply.id,
    reply_to: replyTo,
    ...(resolve && { resolved: true }),
    ...(reply.url && { url: reply.url }),
  };

  if (ctx.outputJson) {
    await writeJsonLine(payload);
  } else {
    console.log(`Replied to ${replyTo} on ${ctx.repo}#${ctx.pr}.`);
  }
}

async function handleCommentAction(
  ctx: AddContext,
  body: string
): Promise<void> {
  const prId = await ctx.client.fetchPullRequestId(ctx.owner, ctx.name, ctx.pr);
  const comment = await ctx.client.addIssueComment(prId, body);

  const payload = {
    ok: true,
    repo: ctx.repo,
    pr: ctx.pr,
    comment_id: comment.id,
    ...(comment.url && { url: comment.url }),
  };

  if (ctx.outputJson) {
    await writeJsonLine(payload);
  } else {
    console.log(`Added comment to ${ctx.repo}#${ctx.pr}.`);
  }
}

function validateOptions(
  options: AddCommandOptions,
  body: string | undefined,
  hasMetadata: boolean,
  hasReview: boolean
): void {
  if (options.resolve && !options.reply) {
    console.error("--resolve requires --reply.");
    process.exit(1);
  }

  if (hasReview && hasMetadata) {
    console.error(
      "Review actions cannot be combined with label/reviewer/assignee updates."
    );
    process.exit(1);
  }

  if (!hasReview && !hasMetadata && !body) {
    console.error("Comment body is required.");
    process.exit(1);
  }

  if (hasMetadata && body) {
    console.error(
      "Remove the body argument when adding labels/reviewers/assignees."
    );
    process.exit(1);
  }
}

function printDeprecationWarning(): void {
  console.error(
    "\u001B[33mWarning: 'fw add' is deprecated. Use these alternatives:\u001B[0m"
  );
  console.error("  Comments:  fw pr comment <pr> \"text\"");
  console.error("  Reviews:   fw pr review <pr> --approve");
  console.error("  Replies:   fw fb <comment-id> \"text\"");
  console.error("  Metadata:  fw pr edit <pr> --add-label X --add-reviewer Y");
  console.error("");
}

export const addCommand = new Command("add")
  .description("Add comments, reviews, or metadata to PRs (deprecated)")
  .argument("<pr>", "PR number", parsePrNumber)
  .argument("[body]", "Comment or review body")
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("--reply <commentId>", "Reply to a review thread comment")
  .option("--resolve", "Resolve the thread after replying")
  .option("--review <type>", "Add review (approve, request-changes, comment)")
  .option("--label <name>", "Add label (repeatable)", collect)
  .option("--reviewer <user>", "Add reviewer (repeatable)", collect)
  .option("--assignee <user>", "Add assignee (repeatable)", collect)
  .option("--json", "Force JSON output")
  .option("--no-json", "Force human-readable output")
  .action(
    async (
      pr: number,
      body: string | undefined,
      options: AddCommandOptions
    ) => {
      printDeprecationWarning();
      try {
        const labels = options.label ?? [];
        const reviewers = options.reviewer ?? [];
        const assignees = options.assignee ?? [];
        const hasMetadata =
          labels.length > 0 || reviewers.length > 0 || assignees.length > 0;
        const hasReview = Boolean(options.review);

        validateOptions(options, body, hasMetadata, hasReview);

        const config = await loadConfig();
        const repo = await resolveRepoOrThrow(options.repo);
        const { owner, name } = parseRepoInput(repo);

        const auth = await detectAuth(config.github_token);
        if (!auth.token) {
          console.error(auth.error);
          process.exit(1);
        }

        const ctx: AddContext = {
          client: new GitHubClient(auth.token),
          owner,
          name,
          repo,
          pr,
          outputJson: shouldOutputJson(options, config.output?.default_format),
        };

        if (hasReview) {
          await handleReviewAction(ctx, options.review!, body);
          return;
        }

        if (hasMetadata) {
          await handleMetadataAction(ctx, labels, reviewers, assignees);
          return;
        }

        if (options.reply) {
          await handleReplyAction(
            ctx,
            options.reply,
            body ?? "",
            Boolean(options.resolve)
          );
          return;
        }

        await handleCommentAction(ctx, body ?? "");
      } catch (error) {
        console.error(
          "Add failed:",
          error instanceof Error ? error.message : error
        );
        process.exit(1);
      }
    }
  );
