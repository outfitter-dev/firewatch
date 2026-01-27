import { Command } from "commander";

const EXAMPLES = `
# ═══════════════════════════════════════════════════════════════════════════════
# Firewatch CLI Examples
# ═══════════════════════════════════════════════════════════════════════════════

# ─── Daily Review Workflow ───────────────────────────────────────────────────

# See what needs attention
fw list

# View specific feedback with context
fw view @abc12

# Reply and resolve
fw reply @abc12 "Fixed in latest commit" --resolve

# Or just resolve without reply
fw close @abc12

# ─── PR Review Workflow ──────────────────────────────────────────────────────

# List PRs needing review
fw list prs --reviews

# View PR details
fw view 42

# Approve or reject
fw approve 42 -b "LGTM!"
fw reject 42 -b "Needs error handling for edge case X"

# ─── Bulk Operations ─────────────────────────────────────────────────────────

# Acknowledge all feedback in a PR
fw ack 42 --yes

# Close all feedback in a PR
fw close 42 --feedback --yes

# ─── Query + jq Patterns ─────────────────────────────────────────────────────
#
# Firewatch outputs JSONL (one JSON object per line). Pipe to jq for filtering.
#
# ⚠️  ESCAPING TIP: Avoid != in jq expressions - bash escapes ! as \\!
#     Use "| not" pattern instead: select(.x == "y" | not)

# Filter by type
fw query | jq 'select(.type == "comment")'
fw query | jq 'select(.type == "review")'

# Filter by author
fw query | jq 'select(.author == "alice")'
fw query --exclude-author bot | jq '.'

# Group by PR
fw query | jq -s 'group_by(.pr)'

# Count by type
fw query | jq -s 'group_by(.type) | map({type: .[0].type, count: length})'

# ─── Sync and Cache ──────────────────────────────────────────────────────────

# Incremental sync (open only)
fw sync

# Full resync (ignore cursors)
fw sync --full

# Clear cache and resync
fw sync --clear
`.trim();

export function printExamples(): void {
  console.log(EXAMPLES);
}

export const examplesCommand = new Command("examples")
  .description("Show common jq patterns for filtering Firewatch output")
  .alias("patterns")
  .option("--debug", "Enable debug logging")
  .option("--no-color", "Disable color output")
  .action(() => {
    printExamples();
  });
