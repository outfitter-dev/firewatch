/**
 * Top-level reject command for Firewatch CLI.
 *
 * Requests changes on a PR. This is a dedicated command for quick access,
 * equivalent to `fw pr review <pr> --request-changes --body <text>`.
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

export interface RejectCommandOptions {
  repo?: string;
  body?: string;
  jsonl?: boolean;
  json?: boolean;
  debug?: boolean;
  noColor?: boolean;
}

interface RejectContext {
  client: GitHubClient;
  config: FirewatchConfig;
  repo: string;
  owner: string;
  name: string;
  outputJson: boolean;
}

async function createContext(options: RejectCommandOptions): Promise<RejectContext> {
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

export async function rejectAction(
  pr: number,
  options: RejectCommandOptions
): Promise<void> {
  applyCommonOptions(options);
  if (!options.body) {
    console.error("Body is required for rejecting a PR. Use -b to provide a reason.");
    process.exit(1);
  }

  try {
    const ctx = await createContext(options);

    const review = await ctx.client.addReview(
      ctx.owner,
      ctx.name,
      pr,
      "request-changes",
      options.body
    );

    const payload = {
      ok: true,
      repo: ctx.repo,
      pr,
      action: "changes_requested",
      ...(review?.id && { review_id: review.id }),
      ...(review?.url && { url: review.url }),
    };

    if (ctx.outputJson) {
      await outputStructured(payload, "jsonl");
    } else {
      console.log(`Requested changes on ${ctx.repo}#${pr}.`);
      if (review?.url) {
        console.log(review.url);
      }
    }
  } catch (error) {
    console.error(
      "Reject failed:",
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }
}

export const rejectCommand = new Command("reject")
  .description("Request changes on a PR")
  .argument("<pr>", "PR number", parsePrNumber)
  .option("--repo <name>", "Repository (owner/repo format)")
  .requiredOption("-b, --body <text>", "Reason for rejection (required)")
  .option("--jsonl", "Force JSONL output")
  .option("--no-jsonl", "Force human-readable output")
  .addOption(new Option("--json").hideHelp())
  .option("--debug", "Enable debug logging")
  .option("--no-color", "Disable color output")
  .action(rejectAction);
