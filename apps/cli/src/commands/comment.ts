import {
  GitHubClient,
  detectAuth,
  detectRepo,
  loadConfig,
} from "@outfitter/firewatch-core";
import { Command } from "commander";

import { parseRepoInput } from "../repo";
import { writeJsonLine } from "../utils/json";

interface CommentCommandOptions {
  repo?: string;
  replyTo?: string;
  resolve?: boolean;
}

async function resolveRepo(repo?: string): Promise<string> {
  if (repo) {
    return repo;
  }

  const detected = await detectRepo();
  if (detected.repo) {
    console.error(`Detected ${detected.repo} from ${detected.source}`);
    return detected.repo;
  }

  throw new Error(
    "No repository detected. Use: fw comment --repo owner/repo"
  );
}

export const commentCommand = new Command("comment")
  .description("Post a PR comment or reply to a review thread")
  .argument("<pr>", "PR number", Number.parseInt)
  .argument("<body>", "Comment body")
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("--reply-to <commentId>", "Reply to a review comment")
  .option("--resolve", "Resolve the review thread after replying")
  .option("--json", "Output JSON (default)")
  .action(
    async (
      pr: number,
      body: string,
      options: CommentCommandOptions
    ) => {
      try {
        if (options.resolve && !options.replyTo) {
          console.error("--resolve requires --reply-to.");
          process.exit(1);
        }

        const config = await loadConfig();
        const repo = await resolveRepo(options.repo);
        const { owner, name } = parseRepoInput(repo);

        const auth = await detectAuth(config.github_token);
        if (!auth.token) {
          console.error(auth.error);
          process.exit(1);
        }

        const client = new GitHubClient(auth.token);

        if (options.replyTo) {
          const threadMap = await client.fetchReviewThreadMap(owner, name, pr);
          const threadId = threadMap.get(options.replyTo);
          if (!threadId) {
            console.error(
              `No review thread found for comment ${options.replyTo}.`
            );
            process.exit(1);
          }

          const reply = await client.addReviewThreadReply(threadId, body);
          if (options.resolve) {
            await client.resolveReviewThread(threadId);
          }

          await writeJsonLine({
            ok: true,
            repo,
            pr,
            comment_id: reply.id,
            reply_to: options.replyTo,
            ...(options.resolve && { resolved: true }),
            ...(reply.url && { url: reply.url }),
          });
          return;
        }

        const prId = await client.fetchPullRequestId(owner, name, pr);
        const comment = await client.addIssueComment(prId, body);

        await writeJsonLine({
          ok: true,
          repo,
          pr,
          comment_id: comment.id,
          ...(comment.url && { url: comment.url }),
        });
      } catch (error) {
        console.error(
          "Comment failed:",
          error instanceof Error ? error.message : error
        );
        process.exit(1);
      }
    }
  );
