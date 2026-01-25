#!/bin/bash
# firewatch SessionStart hook
# Shows quick PR summary and syncs in background

# Check standard install location first
FW_BIN="${HOME}/.local/bin/fw"

# Fallback to PATH
if [[ ! -x "$FW_BIN" ]]; then
  FW_BIN="$(command -v fw 2>/dev/null || true)"
fi

# Exit silently if fw not found
[[ -z "$FW_BIN" || ! -x "$FW_BIN" ]] && exit 0

# Quick summary from existing cache (before sync)
SUMMARY=$("$FW_BIN" --summary 2>/dev/null | jq -rs '
  if length == 0 then "No cached PR data"
  else
    (map(select(.pr_state == "open" or .pr_state == "draft")) | length) as $open |
    (map(.counts.comments) | add // 0) as $comments |
    (map(.last_activity_at) | max // null) as $last |
    if $last then
      ($last | fromdateiso8601 | now - . | . / 3600 | floor) as $hours |
      "\($open) open PRs | \($comments) comments | last activity \($hours)h ago"
    else
      "\($open) open PRs | \($comments) comments"
    end
  end
' 2>/dev/null)

# Run full sync in background
nohup "$FW_BIN" --sync-full --summary >/dev/null 2>&1 &

echo "${SUMMARY:-Sync started in background...}"
echo "Run \`fw --summary\` for full summary"
exit 0
