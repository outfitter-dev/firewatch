/**
 * Freeze command: Mark a PR as frozen at the current timestamp.
 *
 * Frozen PRs continue syncing, but entries created after the freeze
 * timestamp are hidden from query results (unless --include-frozen).
 */
import {
  detectRepo,
  freezePR,
  getDatabase,
  getFrozenPRs,
  loadConfig,
  type FreezeInfo,
} from "@outfitter/firewatch-core";
import { Command, Option } from "commander";

import { validateRepoFormat } from "../repo";
import { outputStructured } from "../utils/json";
import { shouldOutputJson } from "../utils/tty";

interface FreezeCommandOptions {
  repo?: string;
  list?: boolean;
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

function formatFreezeDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleString();
}

async function handleList(
  options: FreezeCommandOptions,
  outputJson: boolean
): Promise<void> {
  if (options.repo) {
    validateRepoFormat(options.repo);
  }

  const db = getDatabase();
  const frozen = getFrozenPRs(db, options.repo);

  if (outputJson) {
    for (const info of frozen) {
      await outputStructured(info, "jsonl");
    }
    return;
  }

  if (frozen.length === 0) {
    const scope = options.repo ? ` in ${options.repo}` : "";
    console.error(`No frozen PRs${scope}.`);
    return;
  }

  console.error(`Frozen PRs (${frozen.length}):`);
  for (const info of frozen) {
    const frozenDate = info.frozen_at ? formatFreezeDate(info.frozen_at) : "";
    console.log(`  ${info.repo}#${info.pr} — frozen at ${frozenDate}`);
  }
}

async function handleFreeze(
  prNumber: number,
  options: FreezeCommandOptions,
  outputJson: boolean
): Promise<void> {
  const repo = await resolveRepo(options.repo);
  const db = getDatabase();

  let info: FreezeInfo;
  try {
    info = freezePR(db, repo, prNumber);
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
        frozen_at: info.frozen_at,
      },
      "jsonl"
    );
    return;
  }

  console.log(`Frozen PR #${prNumber} at ${info.frozen_at}`);
  console.log("Activity after this time will be hidden from queries.");
}

export const freezeCommand = new Command("freeze")
  .description("Freeze a PR - hide new activity after this point")
  .argument("[pr]", "PR number to freeze")
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("-l, --list", "List frozen PRs")
  .option("--jsonl", "Force structured output")
  .option("--no-jsonl", "Force human-readable output")
  .addOption(new Option("--json").hideHelp())
  .action(async (prArg: string | undefined, options: FreezeCommandOptions) => {
    const config = await loadConfig();
    const outputJson = shouldOutputJson(options, config.output?.default_format);

    if (options.list) {
      await handleList(options, outputJson);
      return;
    }

    if (!prArg) {
      console.error("Provide a PR number to freeze, or use --list.");
      process.exit(1);
    }

    const prNumber = Number.parseInt(prArg, 10);
    if (Number.isNaN(prNumber) || prNumber <= 0) {
      console.error(`Invalid PR number: ${prArg}`);
      process.exit(1);
    }

    await handleFreeze(prNumber, options, outputJson);
  });
