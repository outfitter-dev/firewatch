/**
 * Top-level approve command for Firewatch CLI.
 *
 * Approves a PR. This is a dedicated command for quick access,
 * equivalent to `fw pr review <pr> --approve`.
 */

import { exitWithError } from "@outfitter/cli/output";
import {
  approveHandler,
  getDatabase,
  loadConfig,
} from "@outfitter/firewatch-core";
import { silentLogger } from "@outfitter/firewatch-shared";
import { Command, Option } from "commander";

import { applyCommonOptions } from "../query-helpers";
import { parsePrNumber, resolveRepoOrThrow } from "../repo";
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

export async function approveAction(
  pr: number,
  options: ApproveCommandOptions
): Promise<void> {
  applyCommonOptions(options);
  try {
    const config = await loadConfig();
    const db = getDatabase();
    const repo = await resolveRepoOrThrow(options.repo);
    const outputJson = shouldOutputJson(options, config.output?.default_format);

    const result = await approveHandler(
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
      action: "approved",
      ...(review.id && { review_id: review.id }),
      ...(review.url && { url: review.url }),
    };

    if (outputJson) {
      await outputStructured(payload, "jsonl");
    } else {
      console.log(`Approved ${repo}#${pr}.`);
      if (review.url) {
        console.log(review.url);
      }
    }
  } catch (error) {
    exitWithError(error instanceof Error ? error : new Error(String(error)));
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
