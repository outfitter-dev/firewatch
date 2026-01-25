/**
 * Unfreeze command: Remove freeze timestamp from a PR.
 *
 * After unfreezing, all entries for the PR will be visible in queries again.
 */
import {
  countHiddenEntries,
  detectRepo,
  getDatabase,
  getFreezeInfo,
  loadConfig,
  unfreezePR,
} from "@outfitter/firewatch-core";
import { Command, Option } from "commander";

import { validateRepoFormat } from "../repo";
import { outputStructured } from "../utils/json";
import { shouldOutputJson } from "../utils/tty";

interface UnfreezeCommandOptions {
  repo?: string;
  jsonl?: boolean;
  json?: boolean;
}

async function resolveRepo(repo?: string): Promise<string> {
  if (repo) {
    validateRepoFormat(repo);
    return repo;
  }

  const detected = await detectRepo();
  if (!detected.repo) {
    throw new Error("No repository detected. Use --repo owner/repo.");
  }

  return detected.repo;
}

async function handleUnfreeze(
  prNumber: number,
  options: UnfreezeCommandOptions,
  outputJson: boolean
): Promise<void> {
  const repo = await resolveRepo(options.repo);
  const db = getDatabase();

  // Get previous freeze info for reporting
  const previousInfo = getFreezeInfo(db, repo, prNumber);
  if (!previousInfo) {
    if (outputJson) {
      await outputStructured(
        {
          ok: false,
          repo,
          pr: prNumber,
          error: `PR #${prNumber} not found in ${repo}`,
        },
        "jsonl"
      );
      process.exit(1);
    }
    console.error(`PR #${prNumber} not found in ${repo}.`);
    process.exit(1);
  }

  if (!previousInfo.frozen_at) {
    if (outputJson) {
      await outputStructured(
        {
          ok: true,
          repo,
          pr: prNumber,
          was_frozen: false,
          message: "PR was not frozen",
        },
        "jsonl"
      );
      return;
    }
    console.log(`PR #${prNumber} is not frozen.`);
    return;
  }

  // Count hidden entries before unfreezing
  const hiddenCount = countHiddenEntries(db, repo, prNumber);

  try {
    unfreezePR(db, repo, prNumber);
  } catch (error) {
    if (outputJson) {
      await outputStructured(
        {
          ok: false,
          repo,
          pr: prNumber,
          error: error instanceof Error ? error.message : String(error),
        },
        "jsonl"
      );
      process.exit(1);
    }
    throw error;
  }

  if (outputJson) {
    await outputStructured(
      {
        ok: true,
        repo,
        pr: prNumber,
        was_frozen: true,
        previous_frozen_at: previousInfo.frozen_at,
        entries_now_visible: hiddenCount,
      },
      "jsonl"
    );
    return;
  }

  console.log(`Unfrozen PR #${prNumber} (was frozen since ${previousInfo.frozen_at})`);
  if (hiddenCount > 0) {
    console.log(`${hiddenCount} ${hiddenCount === 1 ? "entry is" : "entries are"} now visible again.`);
  }
}

export const unfreezeCommand = new Command("unfreeze")
  .description("Unfreeze a PR - show all activity again")
  .argument("<pr>", "PR number to unfreeze")
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("--jsonl", "Force structured output")
  .option("--no-jsonl", "Force human-readable output")
  .addOption(new Option("--json").hideHelp())
  .action(async (prArg: string, options: UnfreezeCommandOptions) => {
    const config = await loadConfig();
    const outputJson = shouldOutputJson(options, config.output?.default_format);

    const prNumber = Number.parseInt(prArg, 10);
    if (Number.isNaN(prNumber) || prNumber <= 0) {
      console.error(`Invalid PR number: ${prArg}`);
      process.exit(1);
    }

    await handleUnfreeze(prNumber, options, outputJson);
  });
