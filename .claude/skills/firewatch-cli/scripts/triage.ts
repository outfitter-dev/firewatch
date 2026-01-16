#!/usr/bin/env bun
/**
 * Quick PR triage script for agents
 *
 * Combines common firewatch queries into a single overview:
 * - Syncs latest data
 * - Shows PRs needing attention
 * - Lists unaddressed review comments
 *
 * Usage: bun run .claude/skills/firewatch-cli/scripts/triage.ts [--since 24h] [--repo owner/repo]
 */

import { $ } from "bun";

const args = process.argv.slice(2);
const since = args.includes("--since")
  ? args[args.indexOf("--since") + 1]
  : "7d";
const repoArg = args.includes("--repo")
  ? `--repo ${args[args.indexOf("--repo") + 1]}`
  : "";

async function run() {
  console.log("# PR Triage Report\n");

  // Sync
  console.log("## Syncing...\n");
  await $`fw sync ${repoArg}`.quiet();
  await $`fw check ${repoArg}`.quiet();

  // Summary
  console.log(`## Activity Summary (since ${since})\n`);
  const summary = await $`fw query --since ${since} ${repoArg} | jq -s '{
    total_entries: length,
    unique_prs: ([.[].pr] | unique | length),
    reviews: ([.[] | select(.type == "review")] | length),
    comments: ([.[] | select(.type == "comment")] | length),
    commits: ([.[] | select(.type == "commit")] | length)
  }'`.text();
  console.log(summary);

  // PRs needing attention
  console.log("## PRs Needing Attention\n");

  console.log("### Changes Requested\n");
  const changesRequested =
    await $`fw status ${repoArg} | jq -r 'select(.review_states.changes_requested > 0) | "- PR #\\(.pr): \\(.pr_title) (\\(.review_states.changes_requested) changes requested)"'`.text();
  console.log(changesRequested || "(none)\n");

  console.log("### No Reviews Yet\n");
  const noReviews =
    await $`fw status --active ${repoArg} | jq -r 'select(.counts.reviews == 0) | "- PR #\\(.pr): \\(.pr_title) by @\\(.pr_author)"'`.text();
  console.log(noReviews || "(none)\n");

  // Unaddressed comments
  console.log("## Unaddressed Review Comments\n");
  const unaddressed =
    await $`fw query --type comment ${repoArg} | jq -r 'select(
    .subtype == "review_comment" and
    (.file_activity_after.modified // false) == false
  ) | "- PR #\\(.pr) \\(.file):\\(.line // "?") - \\(.body[0:60] | gsub("\\n"; " "))..."'`.text();
  console.log(unaddressed || "(none)\n");

  console.log("---\nRun `fw query` or `fw status` for more details.");
}

try {
  await run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
