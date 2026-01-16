import {
  GitHubClient,
  detectAuth,
  loadConfig,
} from "@outfitter/firewatch-core";
import { Command } from "commander";

import { parseRepoInput, parsePrNumber, resolveRepoOrThrow } from "../repo";
import { writeJsonLine } from "../utils/json";
import { shouldOutputJson } from "../utils/tty";

interface RmCommandOptions {
  repo?: string;
  label?: string[];
  reviewer?: string[];
  assignee?: string[];
  milestone?: boolean;
  json?: boolean;
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export const rmCommand = new Command("rm")
  .description("Remove labels, reviewers, assignees, or milestone from PRs")
  .argument("<pr>", "PR number", parsePrNumber)
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("--label <name>", "Remove label (repeatable)", collect)
  .option("--reviewer <user>", "Remove reviewer (repeatable)", collect)
  .option("--assignee <user>", "Remove assignee (repeatable)", collect)
  .option("--milestone", "Clear milestone")
  .option("--json", "Force JSON output")
  .option("--no-json", "Force human-readable output")
  .action(async (pr: number, options: RmCommandOptions) => {
    try {
      const labels = options.label ?? [];
      const reviewers = options.reviewer ?? [];
      const assignees = options.assignee ?? [];
      const clearMilestone = Boolean(options.milestone);
      const hasWork =
        labels.length > 0 ||
        reviewers.length > 0 ||
        assignees.length > 0 ||
        clearMilestone;

      if (!hasWork) {
        console.error("No removals specified.");
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

      if (labels.length > 0) {
        await client.removeLabels(owner, name, pr, labels);
      }
      if (reviewers.length > 0) {
        await client.removeReviewers(owner, name, pr, reviewers);
      }
      if (assignees.length > 0) {
        await client.removeAssignees(owner, name, pr, assignees);
      }
      if (clearMilestone) {
        await client.clearMilestone(owner, name, pr);
      }

      const payload = {
        ok: true,
        repo,
        pr,
        ...(labels.length > 0 && { labels_removed: labels }),
        ...(reviewers.length > 0 && { reviewers_removed: reviewers }),
        ...(assignees.length > 0 && { assignees_removed: assignees }),
        ...(clearMilestone && { milestone_cleared: true }),
      };

      if (shouldOutputJson(options, config.output?.default_format)) {
        await writeJsonLine(payload);
      } else {
        console.log(`Updated ${repo}#${pr}.`);
      }
    } catch (error) {
      console.error(
        "Remove failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
