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

export const addCommand = new Command("add")
  .description("Add comments, reviews, or metadata to PRs")
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
  .action(async (pr: number, body: string | undefined, options: AddCommandOptions) => {
    try {
      if (options.resolve && !options.reply) {
        console.error("--resolve requires --reply.");
        process.exit(1);
      }

      const labels = options.label ?? [];
      const reviewers = options.reviewer ?? [];
      const assignees = options.assignee ?? [];
      const hasMetadata = labels.length > 0 || reviewers.length > 0 || assignees.length > 0;
      const hasReview = Boolean(options.review);

      if (hasReview && hasMetadata) {
        console.error("Review actions cannot be combined with label/reviewer/assignee updates.");
        process.exit(1);
      }

      if (!hasReview && !hasMetadata && !body) {
        console.error("Comment body is required.");
        process.exit(1);
      }

      if (hasMetadata && body) {
        console.error("Remove the body argument when adding labels/reviewers/assignees.");
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

      const client = new GitHubClient(auth.token);
      const outputJson = shouldOutputJson(options, config.output?.default_format);

      if (hasReview) {
        const event = normalizeReviewEvent(options.review!);
        const review = await client.addReview(owner, name, pr, event, body);
        const payload = {
          ok: true,
          repo,
          pr,
          review: event,
          ...(review?.id && { review_id: review.id }),
          ...(review?.url && { url: review.url }),
        };

        if (outputJson) {
          await writeJsonLine(payload);
        } else {
          console.log(`Added ${event} review on ${repo}#${pr}.`);
        }
        return;
      }

      if (hasMetadata) {
        if (labels.length > 0) {
          await client.addLabels(owner, name, pr, labels);
        }
        if (reviewers.length > 0) {
          await client.requestReviewers(owner, name, pr, reviewers);
        }
        if (assignees.length > 0) {
          await client.addAssignees(owner, name, pr, assignees);
        }

        const payload = {
          ok: true,
          repo,
          pr,
          ...(labels.length > 0 && { labels_added: labels }),
          ...(reviewers.length > 0 && { reviewers_added: reviewers }),
          ...(assignees.length > 0 && { assignees_added: assignees }),
        };

        if (outputJson) {
          await writeJsonLine(payload);
        } else {
          console.log(`Updated ${repo}#${pr}.`);
        }
        return;
      }

      if (options.reply) {
        const threadMap = await client.fetchReviewThreadMap(owner, name, pr);
        const threadId = threadMap.get(options.reply);
        if (!threadId) {
          console.error(`No review thread found for comment ${options.reply}.`);
          process.exit(1);
        }

        const reply = await client.addReviewThreadReply(threadId, body ?? "");
        if (options.resolve) {
          await client.resolveReviewThread(threadId);
        }

        const payload = {
          ok: true,
          repo,
          pr,
          comment_id: reply.id,
          reply_to: options.reply,
          ...(options.resolve && { resolved: true }),
          ...(reply.url && { url: reply.url }),
        };

        if (outputJson) {
          await writeJsonLine(payload);
        } else {
          console.log(`Replied to ${options.reply} on ${repo}#${pr}.`);
        }
        return;
      }

      const prId = await client.fetchPullRequestId(owner, name, pr);
      const comment = await client.addIssueComment(prId, body ?? "");

      const payload = {
        ok: true,
        repo,
        pr,
        comment_id: comment.id,
        ...(comment.url && { url: comment.url }),
      };

      if (outputJson) {
        await writeJsonLine(payload);
      } else {
        console.log(`Added comment to ${repo}#${pr}.`);
      }
    } catch (error) {
      console.error(
        "Add failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
