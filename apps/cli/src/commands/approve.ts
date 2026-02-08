/**
 * Top-level approve command for Firewatch CLI.
 *
 * Approves a PR. This is a dedicated command for quick access,
 * equivalent to `fw pr review <pr> --approve`.
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

export interface ApproveCommandOptions {
  repo?: string;
  body?: string;
  jsonl?: boolean;
  json?: boolean;
  debug?: boolean;
  noColor?: boolean;
}

interface ApproveContext {
  client: GitHubClient;
  config: FirewatchConfig;
  repo: string;
  owner: string;
  name: string;
  outputJson: boolean;
}

async function createContext(options: ApproveCommandOptions): Promise<ApproveContext> {
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

export async function approveAction(
  pr: number,
  options: ApproveCommandOptions
): Promise<void> {
  applyCommonOptions(options);
  try {
    const ctx = await createContext(options);

    const review = await ctx.client.addReview(
      ctx.owner,
      ctx.name,
      pr,
      "approve",
      options.body
    );

    const payload = {
      ok: true,
      repo: ctx.repo,
      pr,
      action: "approved",
      ...(review?.id && { review_id: review.id }),
      ...(review?.url && { url: review.url }),
    };

    if (ctx.outputJson) {
      await outputStructured(payload, "jsonl");
    } else {
      console.log(`Approved ${ctx.repo}#${pr}.`);
      if (review?.url) {
        console.log(review.url);
      }
    }
  } catch (error) {
    console.error(
      "Approve failed:",
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }
}

export const approveCommand = new Command("approve")
  .description("Approve a PR")
  .argument("<pr>", "PR number", parsePrNumber)
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("-b, --body <text>", "Optional approval message")
  .option("--jsonl", "Force JSONL output")
  .option("--no-jsonl", "Force human-readable output")
  .addOption(new Option("--json").hideHelp())
  .option("--debug", "Enable debug logging")
  .option("--no-color", "Disable color output")
  .action(approveAction);
