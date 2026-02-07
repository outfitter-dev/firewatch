/**
 * Top-level comment command for Firewatch CLI.
 *
 * Adds a PR-level comment. This is a top-level command for quick access,
 * equivalent to `fw pr comment`.
 */

import {
  GitHubClient,
  detectAuth,
  loadConfig,
  type FirewatchConfig,
} from "@outfitter/firewatch-core";
import { Command, Option } from "commander";

import { applyCommonOptions } from "../query-helpers";
import { parseRepoInput, parsePrNumber, resolveRepoOrThrow } from "../repo";
import { outputStructured } from "../utils/json";
import { shouldOutputJson } from "../utils/tty";

export interface CommentCommandOptions {
  repo?: string;
  jsonl?: boolean;
  json?: boolean;
  debug?: boolean;
  noColor?: boolean;
}

interface CommentContext {
  client: GitHubClient;
  config: FirewatchConfig;
  repo: string;
  owner: string;
  name: string;
  outputJson: boolean;
}

async function createContext(
  options: CommentCommandOptions
): Promise<CommentContext> {
  const config = await loadConfig();
  const repo = await resolveRepoOrThrow(options.repo);
  const { owner, name } = parseRepoInput(repo);

  const auth = await detectAuth(config.github_token);
  if (auth.isErr()) {
    throw new Error(auth.error.message);
  }

  const client = new GitHubClient(auth.value.token);

  return {
    client,
    config,
    repo,
    owner,
    name,
    outputJson: shouldOutputJson(options, config.output?.default_format),
  };
}

export async function commentAction(
  pr: number,
  body: string,
  options: CommentCommandOptions
): Promise<void> {
  applyCommonOptions(options);
  if (!body.trim()) {
    console.error("Comment body cannot be empty.");
    process.exit(1);
  }

  try {
    const ctx = await createContext(options);

    const prIdResult = await ctx.client.fetchPullRequestId(ctx.owner, ctx.name, pr);
    if (prIdResult.isErr()) {
      throw prIdResult.error;
    }
    const commentResult = await ctx.client.addIssueComment(prIdResult.value, body);
    if (commentResult.isErr()) {
      throw commentResult.error;
    }
    const comment = commentResult.value;

    const payload = {
      ok: true,
      repo: ctx.repo,
      pr,
      action: "comment",
      id: comment.id,
      ...(comment.url && { url: comment.url }),
    };

    if (ctx.outputJson) {
      await outputStructured(payload, "jsonl");
    } else {
      console.log(`Added comment to ${ctx.repo}#${pr}.`);
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
}

export const commentCommand = new Command("comment")
  .description("Add a comment to a PR")
  .argument("<pr>", "PR number", parsePrNumber)
  .argument("<body>", "Comment text")
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("--jsonl", "Force JSONL output")
  .option("--no-jsonl", "Force human-readable output")
  .addOption(new Option("--json").hideHelp())
  .option("--debug", "Enable debug logging")
  .option("--no-color", "Disable color output")
  .action(commentAction);
