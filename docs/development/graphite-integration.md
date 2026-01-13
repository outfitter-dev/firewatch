# Graphite Integration

> Internal notes on integrating with Graphite CLI (`gt`) for stack-aware features.

## Overview

Firewatch's Graphite plugin enriches PR activity entries with stack context. This doc captures CLI capabilities, limitations, and implementation patterns discovered during development.

## gt CLI Capabilities

### What gt Exposes

| Command | Output | Useful For |
|---------|--------|------------|
| `gt log --stack --no-interactive` | Human-readable branch tree | Understanding stack structure |
| `gt branch info` | Branch details | Current branch context |
| `gt branch info --stat` | Diffstat vs parent | File change summary (human-readable) |
| `gt branch info --diff` | Full diff vs parent | Detailed changes (human-readable) |

### What gt Does NOT Expose

- **JSON output** — Current gt versions do not expose JSON for stack structure.
- **File changes in JSON** — No `--json` flag for `--stat` or `--diff` output.
- **Stack-wide file mapping** — No command to get "which branch changed which files".

### JSON Output Availability

```bash
# Not supported in current gt versions
gt log --json      # unknown argument: json
gt branch info --json
```

## Hybrid Approach: gt + git

Since gt doesn't expose file changes programmatically, combine gt (for stack structure) with git (for file diffs).

### Getting Stack Branches

```bash
# Human-readable - need to parse
gt log --stack

# Alternative: walk the tree programmatically
current=$(git branch --show-current)
parent=$(gt branch info --json | jq -r '.parent // "main"')
```

### Getting Files Changed Per Branch

```bash
# Git does the heavy lifting
git diff --name-only ${parent}..${branch}

# With commit info
git log --name-only --pretty=format:"%h" ${parent}..${branch}
```

### Getting PR Number for Branch

```bash
# Option 1: GitHub CLI
gh pr list --head ${branch} --json number -q '.[0].number'

# Option 2: Parse gt output (fragile)
gt branch info | grep -oP 'PR #\K\d+'
```

## File Provenance Implementation

### Purpose

When a comment references a file (e.g., "bug in src/auth/service.ts:45"), agents need to know which PR in the stack last modified that file to fix it at the source.

### Data Structure

```typescript
interface FileProvenance {
  origin_pr: number;        // PR where file was changed
  origin_branch: string;    // Branch name
  origin_commit: string;    // SHA (short)
  stack_position: number;   // 1 = bottom of stack
}
```

### Build Algorithm

```typescript
async function buildFileProvenanceMap(): Promise<Map<string, FileProvenance>> {
  const fileMap = new Map<string, FileProvenance>();

  // 1. Get stack branches in order (bottom to top)
  const branches = await getStackBranches();

  // 2. For each branch, get files changed relative to parent
  for (let i = 0; i < branches.length; i++) {
    const branch = branches[i];
    const parent = await getParentBranch(branch);

    const files = await $`git diff --name-only ${parent}..${branch}`.text();
    const commit = await $`git rev-parse --short ${branch}`.text();
    const prNumber = await getPrForBranch(branch);

    for (const file of files.trim().split('\n').filter(Boolean)) {
      // Later branches overwrite earlier — most recent modifier wins
      fileMap.set(file, {
        origin_pr: prNumber,
        origin_branch: branch,
        origin_commit: commit.trim(),
        stack_position: i + 1
      });
    }
  }

  return fileMap;
}
```

### Caching Strategy

- **Location**: `~/.cache/firewatch/stacks/{repo}/{stack_id}.json`
- **Compute**: During `fw sync` when Graphite plugin detects a stack
- **Invalidate**: On restack, new commits, or stack structure changes

### Edge Cases

1. **File modified in multiple branches** — Later branch wins (most recent modifier)
2. **File deleted then re-added** — Treat as modification in re-adding branch
3. **Renamed files** — Consider using `git diff --name-status` to detect renames
4. **No stack context** — Return `null` provenance, agent fixes in current branch

## Stack Health Detection

### Restack Needed

gt can detect this but requires local checkout:

```bash
# gt branch restack has no dry-run flag; use merge-base to detect drift
if [ "$(git merge-base "${branch}" "${parent}")" != "$(git rev-parse "${parent}")" ]; then
  echo "restack needed"
fi
```

### Parent Merged

```bash
# Check PR state via GitHub
gh pr view ${parent_pr} --json state -q '.state'
```

## Testing Considerations

### Mock Stack for Tests

Create a test fixture with known stack structure:

```bash
# Setup
git checkout -b feat/base main
echo "base" > base.txt && git add . && git commit -m "base"

git checkout -b feat/middle
echo "middle" > middle.txt && git add . && git commit -m "middle"

git checkout -b feat/top
echo "top" > top.txt && git add . && git commit -m "top"
```

### Without Graphite Auth

Some gt commands require auth. For CI/testing:
- Mock the stack structure
- Use git directly for file diffs
- Skip PR number lookups or mock them

## References

- [Graphite CLI Docs](https://graphite.dev/docs)
- [gt Command Reference](https://graphite.dev/docs/command-reference)
- Findings from: `.scratch/SCRATCHPAD.md` (Stack File Provenance section)
