import {
  GitHubClient,
  detectAuth,
  loadConfig,
} from "@outfitter/firewatch-core";
import { Command } from "commander";

import { parseRepoInput, parsePrNumber, resolveRepoOrThrow } from "../../repo";
import { writeJsonLine } from "../../utils/json";
import { shouldOutputJson } from "../../utils/tty";

type ReviewEvent = "approve" | "request-changes" | "comment";

interface ReviewCommandOptions {
  repo?: string;
  approve?: boolean;
  requestChanges?: boolean;
  comment?: boolean;
  body?: string;
  json?: boolean;
}

const EVENT_LABELS: Record<ReviewEvent, string> = {
  approve: "Approved",
  "request-changes": "Requested changes on",
  comment: "Commented on",
};

function determineReviewEvent(
  options: ReviewCommandOptions
): ReviewEvent | null {
  const flags = [options.approve, options.requestChanges, options.comment];
  const setCount = flags.filter(Boolean).length;

  if (setCount !== 1) {
    return null;
  }

  if (options.approve) {
    return "approve";
  }
  if (options.requestChanges) {
    return "request-changes";
  }
  if (options.comment) {
    return "comment";
  }

  return null;
}

function validateReviewOptions(
  event: ReviewEvent | null,
  options: ReviewCommandOptions
): { valid: true; event: ReviewEvent } | { valid: false; error: string } {
  if (!event) {
    const setFlags = [
      options.approve && "--approve",
      options.requestChanges && "--request-changes",
      options.comment && "--comment",
    ].filter(Boolean);

    if (setFlags.length > 1) {
      return {
        valid: false,
        error: `Cannot combine review types: ${setFlags.join(", ")}. Use only one.`,
      };
    }
    return {
      valid: false,
      error: "Specify review type: --approve, --request-changes, or --comment.",
    };
  }

  if ((event === "request-changes" || event === "comment") && !options.body) {
    const flagName =
      event === "request-changes" ? "request-changes" : "comment";
    return { valid: false, error: `--body is required for --${flagName}.` };
  }

  return { valid: true, event };
}

export const reviewCommand = new Command("review")
  .description("Submit a review on a PR")
  .argument("<pr>", "PR number", parsePrNumber)
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("-a, --approve", "Approve the PR")
  .option("-r, --request-changes", "Request changes")
  .option("-c, --comment", "Leave a comment review (no approval/changes)")
  .option(
    "-b, --body <text>",
    "Review body (required for --request-changes and --comment)"
  )
  .option("--json", "Force JSON output")
  .option("--no-json", "Force human-readable output")
  .action(async (pr: number, options: ReviewCommandOptions) => {
    try {
      const rawEvent = determineReviewEvent(options);
      const validation = validateReviewOptions(rawEvent, options);

      if (!validation.valid) {
        console.error(validation.error);
        process.exit(1);
      }

      const event = validation.event;

      const config = await loadConfig();
      const repo = await resolveRepoOrThrow(options.repo);
      const { owner, name } = parseRepoInput(repo);

      const auth = await detectAuth(config.github_token);
      if (!auth.token) {
        console.error(auth.error);
        process.exit(1);
      }

      const client = new GitHubClient(auth.token);
      const outputJson = shouldOutputJson(
        options,
        config.output?.default_format
      );

      const review = await client.addReview(
        owner,
        name,
        pr,
        event,
        options.body
      );

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
        console.log(`${EVENT_LABELS[event]} ${repo}#${pr}.`);
        if (review?.url) {
          console.log(review.url);
        }
      }
    } catch (error) {
      console.error(
        "Review failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
