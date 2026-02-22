/**
 * Top-level reject command for Firewatch CLI.
 *
 * Requests changes on a PR. This is a dedicated command for quick access,
 * equivalent to `fw pr review <pr> --request-changes --body <text>`.
 */

import { exitWithError } from "@outfitter/cli/output";
import {
  getDatabase,
  loadConfig,
  rejectHandler,
} from "@outfitter/firewatch-core";
import { silentLogger } from "@outfitter/firewatch-shared";
import { Command, Option } from "commander";

import { applyCommonOptions } from "../query-helpers";
import { parsePrNumber, resolveRepoOrThrow } from "../repo";
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

export async function rejectAction(
  pr: number,
  options: RejectCommandOptions
): Promise<void> {
  applyCommonOptions(options);
  if (!options.body) {
    exitWithError(
      new Error(
        "Body is required for rejecting a PR. Use -b to provide a reason."
      )
    );
  }

  try {
    const config = await loadConfig();
    const db = getDatabase();
    const repo = await resolveRepoOrThrow(options.repo);
    const outputJson = shouldOutputJson(options, config.output?.default_format);

    const result = await rejectHandler(
      { pr, repo, body: options.body },
      { config, db, logger: silentLogger }
    );

    if (result.isErr()) {
      exitWithError(result.error);
    }

    const review = result.value;
    const payload = {
      ok: true,
      repo,
      pr,
      action: "changes_requested",
      ...(review.id && { review_id: review.id }),
      ...(review.url && { url: review.url }),
    };

    if (outputJson) {
      await outputStructured(payload, "jsonl");
    } else {
      console.log(`Requested changes on ${repo}#${pr}.`);
      if (review.url) {
        console.log(review.url);
      }
    }
  } catch (error) {
    exitWithError(error instanceof Error ? error : new Error(String(error)));
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
