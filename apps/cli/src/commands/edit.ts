import {
  GitHubClient,
  detectAuth,
  loadConfig,
} from "@outfitter/firewatch-core";
import { Command } from "commander";

import { parseRepoInput, resolveRepoOrThrow } from "../repo";
import { writeJsonLine } from "../utils/json";
import { shouldOutputJson } from "../utils/tty";

interface EditCommandOptions {
  repo?: string;
  title?: string;
  body?: string;
  base?: string;
  milestone?: string;
  draft?: boolean;
  ready?: boolean;
  json?: boolean;
  noJson?: boolean;
}

export const editCommand = new Command("edit")
  .description("Edit PR fields or state")
  .argument("<pr>", "PR number", Number.parseInt)
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("--title <text>", "Change PR title")
  .option("--body <text>", "Change PR description")
  .option("--base <branch>", "Change base branch")
  .option("--milestone <name>", "Set milestone by name")
  .option("--draft", "Convert to draft")
  .option("--ready", "Mark ready for review")
  .option("--json", "Force JSON output")
  .option("--no-json", "Force human-readable output")
  .action(async (pr: number, options: EditCommandOptions) => {
    try {
      if (options.draft && options.ready) {
        console.error("Cannot use --draft and --ready together.");
        process.exit(1);
      }

      const hasEdit =
        options.title ||
        options.body ||
        options.base ||
        options.milestone ||
        options.draft ||
        options.ready;

      if (!hasEdit) {
        console.error("No edits specified.");
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
      const outputJson = shouldOutputJson(options, config.output?.default_format);

      if (options.title || options.body || options.base) {
        await client.editPullRequest(owner, name, pr, {
          ...(options.title && { title: options.title }),
          ...(options.body && { body: options.body }),
          ...(options.base && { base: options.base }),
        });
      }

      if (options.milestone) {
        await client.setMilestone(owner, name, pr, options.milestone);
      }

      if (options.draft || options.ready) {
        const prId = await client.fetchPullRequestId(owner, name, pr);
        if (options.draft) {
          await client.convertPullRequestToDraft(prId);
        }
        if (options.ready) {
          await client.markPullRequestReady(prId);
        }
      }

      const payload = {
        ok: true,
        repo,
        pr,
        ...(options.title && { title: options.title }),
        ...(options.body && { body: options.body }),
        ...(options.base && { base: options.base }),
        ...(options.milestone && { milestone: options.milestone }),
        ...(options.draft && { draft: true }),
        ...(options.ready && { ready: true }),
      };

      if (outputJson) {
        await writeJsonLine(payload);
      } else {
        console.log(`Updated ${repo}#${pr}.`);
      }
    } catch (error) {
      console.error(
        "Edit failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
