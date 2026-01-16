---
description: Show pending reviews needing attention
allowed-tools: Bash(fw *)
---

# Pending Reviews

## Review Comments (Last 24h)
!`fw query --type review --since 24h 2>&1`

## Summary

Analyze the review activity and highlight:
- Unresolved review threads
- Reviews requesting changes
- Reviews awaiting response
- Approved PRs ready to merge

Suggest which reviews need immediate attention.
