import {
  GitHubClient,
  detectAuth,
  loadConfig,
} from "@outfitter/firewatch-core";
import { Command } from "commander";

import { parseRepoInput, parsePrNumber, resolveRepoOrThrow } from "../../repo";
import { writeJsonLine } from "../../utils/json";
import { shouldOutputJson } from "../../utils/tty";

interface CommentCommandOptions {
  repo?: string;
  json?: boolean;
}

export const commentCommand = new Command("comment")
  .description("Add a comment to a PR")
  .argument("<pr>", "PR number", parsePrNumber)
  .argument("<body>", "Comment body")
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("--json", "Force JSON output")
  .option("--no-json", "Force human-readable output")
  .action(async (pr: number, body: string, options: CommentCommandOptions) => {
    try {
      if (!body.trim()) {
        console.error("Comment body cannot be empty.");
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
      const outputJson = shouldOutputJson(
        options,
        config.output?.default_format
      );

      const prId = await client.fetchPullRequestId(owner, name, pr);
      const comment = await client.addIssueComment(prId, body);

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
        if (comment.url) {
          console.log(comment.url);
        }
      }
    } catch (error) {
      console.error(
        "Comment failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
