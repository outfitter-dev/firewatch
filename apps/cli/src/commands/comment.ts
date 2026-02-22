/**
 * Top-level comment command for Firewatch CLI.
 *
 * Adds a PR-level comment. This is a top-level command for quick access,
 * equivalent to `fw pr comment`.
 */

import { exitWithError } from "@outfitter/cli/output";
import {
  commentHandler,
  getDatabase,
  loadConfig,
} from "@outfitter/firewatch-core";
import { silentLogger } from "@outfitter/firewatch-shared";
import { Command, Option } from "commander";

import { applyCommonOptions } from "../query-helpers";
import { parsePrNumber, resolveRepoOrThrow } from "../repo";
import { outputStructured } from "../utils/json";
import { shouldOutputJson } from "../utils/tty";

export interface CommentCommandOptions {
  repo?: string;
  jsonl?: boolean;
  json?: boolean;
  debug?: boolean;
  noColor?: boolean;
}

export async function commentAction(
  pr: number,
  body: string,
  options: CommentCommandOptions
): Promise<void> {
  applyCommonOptions(options);
  if (!body.trim()) {
    exitWithError(new Error("Comment body cannot be empty."));
  }

  try {
    const config = await loadConfig();
    const db = getDatabase();
    const repo = await resolveRepoOrThrow(options.repo);
    const outputJson = shouldOutputJson(options, config.output?.default_format);

    const result = await commentHandler(
      { pr, body, repo },
      { config, db, logger: silentLogger }
    );

    if (result.isErr()) {
      exitWithError(result.error);
    }

    const comment = result.value;
    const payload = {
      ok: true,
      repo,
      pr,
      action: "comment",
      id: comment.id,
      ...(comment.url && { url: comment.url }),
    };

    if (outputJson) {
      await outputStructured(payload, "jsonl");
    } else {
      console.log(`Added comment to ${repo}#${pr}.`);
      if (comment.url) {
        console.log(comment.url);
      }
    }
  } catch (error) {
    exitWithError(error instanceof Error ? error : new Error(String(error)));
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
