---
description: Show PR activity summary and worklist
allowed-tools: Bash(fw *)
---

# Firewatch Status

## PR Worklist
!`fw status --short 2>&1`

## Summary

Provide a quick assessment of the PR activity:
- Review needed: PRs with unaddressed review comments
- Stale: PRs with no recent activity
- Ready: PRs approved and ready to merge
- Blocked: PRs with changes requested

Suggest next actions based on the worklist state.
