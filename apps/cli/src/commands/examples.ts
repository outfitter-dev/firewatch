import { Command } from "commander";

const EXAMPLES = `
# ═══════════════════════════════════════════════════════════════════════════════
# Firewatch jq Patterns
# ═══════════════════════════════════════════════════════════════════════════════
#
# Firewatch outputs JSONL (one JSON object per line). Pipe to jq for filtering.
#
# ⚠️  ESCAPING TIP: Avoid != in jq expressions - bash escapes ! as \\!
#     Use "| not" pattern instead: select(.x == "y" | not)
#
# ═══════════════════════════════════════════════════════════════════════════════

# ─── Basic Filtering ──────────────────────────────────────────────────────────

# Filter by type
fw | jq 'select(.type == "comment")'
fw | jq 'select(.type == "review")'
fw | jq 'select(.type == "commit")'

# Filter by author (use "| not" to exclude - avoids != escaping issues)
fw | jq 'select(.author == "alice")'
fw | jq 'select(.author == "alice" | not)'

# Exclude bots (regex match with "| not")
fw | jq 'select(.author | test("bot|\\\\[bot\\\\]") | not)'

# ─── Null Checks ──────────────────────────────────────────────────────────────

# Has file (inline comments) - truthy check, no != needed
fw | jq 'select(.file)'

# No file (PR-level comments)
fw | jq 'select(.file | not)'

# Has body content
fw | jq 'select(.body and (.body | length > 0))'

# ─── Grouping & Aggregation ───────────────────────────────────────────────────

# Group by PR (use -s to slurp into array first)
fw | jq -s 'group_by(.pr)'

# Count by type
fw | jq -s 'group_by(.type) | map({type: .[0].type, count: length})'

# Group comments by PR with metadata
fw --type comment | jq -s '
  group_by(.pr) | map({
    pr: .[0].pr,
    pr_title: .[0].pr_title,
    count: length,
    authors: [.[].author] | unique
  })'

# ─── Time Filtering ───────────────────────────────────────────────────────────

# Combine with --since for time-based queries
fw --since 24h | jq 'select(.type == "comment")'
fw --since 7d --type review | jq -s 'length'

# ─── Inline Review Comments ───────────────────────────────────────────────────

# Get inline comments with file context
fw --type comment | jq 'select(.file) | {author, file, line, body}'

# Group inline comments by file
fw --type comment | jq -s '
  map(select(.file)) |
  group_by(.file) |
  map({file: .[0].file, comments: length})'

# ─── Review States ────────────────────────────────────────────────────────────

# Find approved reviews
fw --type review | jq 'select(.state == "approved")'

# Find changes requested
fw --type review | jq 'select(.state == "changes_requested")'

# ─── Complex Queries ──────────────────────────────────────────────────────────

# Non-bot inline comments with substantive body
fw --type comment --no-bots | jq '
  select(.file) |
  select(.body | length > 50) |
  {pr, author, file, line, body: .body[:200]}'

# Activity summary per PR
fw --since 7d | jq -s '
  group_by(.pr) | map({
    pr: .[0].pr,
    title: .[0].pr_title,
    comments: map(select(.type == "comment")) | length,
    reviews: map(select(.type == "review")) | length,
    commits: map(select(.type == "commit")) | length
  })'
`.trim();

export function printExamples(): void {
  console.log(EXAMPLES);
}

export const examplesCommand = new Command("examples")
  .description("Show common jq patterns for filtering Firewatch output")
  .alias("patterns")
  .action(() => {
    printExamples();
  });
