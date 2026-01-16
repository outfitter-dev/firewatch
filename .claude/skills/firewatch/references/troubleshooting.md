# Troubleshooting Reference

Common issues and fixes when using Firewatch.

## Diagnostic Commands

### Check Overall Health

```bash
fw doctor
```

This checks:
- Authentication status
- Cache integrity
- Repository detection
- Configuration validity

### Check Status

```bash
fw status --short
```

Quick view of cache state and recent sync info.

## Authentication Issues

### "Authentication failed"

**Symptoms:** Sync fails with auth error

**Solutions:**

1. Check `gh` CLI is authenticated:
   ```bash
   gh auth status
   ```

2. If not, authenticate:
   ```bash
   gh auth login
   ```

3. Or set token in environment:
   ```bash
   export GITHUB_TOKEN=ghp_...
   ```

4. Or set in config:
   ```bash
   fw config token ghp_...
   ```

### "Rate limit exceeded"

**Symptoms:** Sync fails with 403 or rate limit message

**Solutions:**

1. Wait for rate limit reset (usually 1 hour)
2. Use a token with higher limits
3. Sync fewer PRs: `fw --since 7d`

### "Bad credentials"

**Symptoms:** 401 error during sync

**Solutions:**

1. Regenerate your token
2. Check token hasn't expired
3. Verify token has required scopes (repo, read:org)

## Sync Issues

### "No PRs found"

**Symptoms:** Sync completes but cache is empty

**Causes:**
- Wrong repository
- No open PRs
- All PRs older than sync window

**Solutions:**

1. Verify correct repo:
   ```bash
   fw status
   git remote -v
   ```

2. Check for closed PRs:
   ```bash
   fw --closed
   ```

3. Extend time window:
   ```bash
   fw --since 30d
   ```

### "Repository not found"

**Symptoms:** Sync fails with 404

**Solutions:**

1. Check repo name is correct:
   ```bash
   git remote -v
   ```

2. Verify you have access to the repo:
   ```bash
   gh repo view owner/repo
   ```

3. Specify repo explicitly:
   ```bash
   fw --repo owner/repo
   ```

### Stale Data

**Symptoms:** Comments appear that were already resolved

**Solutions:**

1. Force fresh sync:
   ```bash
   fw --refresh full
   ```

2. Clear cache and re-sync:
   ```bash
   rm -rf ~/.cache/firewatch/repos/*
   fw --refresh
   ```

## Query Issues

### "No results"

**Symptoms:** Query returns empty

**Causes:**
- Filters too narrow
- Cache is empty
- Wrong PR number

**Solutions:**

1. Check cache has data:
   ```bash
   fw --limit 5
   ```

2. Remove filters to broaden:
   ```bash
   fw --prs PR_NUMBER  # Just PR filter
   ```

3. Check PR exists in cache:
   ```bash
   fw | jq 'select(.pr == PR_NUMBER)' | head -1
   ```

### Missing Fields

**Symptoms:** `.graphite` or `.file_activity_after` is null

**Solutions:**

For Graphite metadata:
- Ensure you're in a repo with Graphite stacks (`gt state`)
- Re-sync: `fw --refresh`

For file activity:
- This field is populated based on commit activity after the comment
- Re-sync to update: `fw --refresh`

### jq Parse Errors

**Symptoms:** `parse error` or `unexpected token`

**Common causes:**
- Empty output (no matching entries)
- Malformed jq expression

**Solutions:**

1. Check there's output:
   ```bash
   fw --limit 1
   ```

2. Test jq expression incrementally:
   ```bash
   fw | jq '.' | head -1  # Just parse
   fw | jq '.type'         # Simple field
   fw | jq 'select(.type == "comment")'  # Add filter
   ```

## Resolution Issues

### "Comment not found"

**Symptoms:** `fw close` or `--reply` fails

**Solutions:**

1. Verify the ID exists:
   ```bash
   fw | jq 'select(.id == "IC_...")'
   ```

2. Check it's a review comment (not issue comment):
   ```bash
   fw | jq 'select(.id == "IC_...") | .subtype'
   ```

3. Re-sync and try again:
   ```bash
   fw --refresh
   ```

### "Cannot resolve"

**Symptoms:** Resolve command fails with permission error

**Causes:**
- Not a thread (regular issue comment)
- Don't have write access
- Thread already resolved

**Solutions:**

1. Verify it's a review thread:
   ```bash
   fw | jq 'select(.id == "IC_...") | {subtype, type}'
   ```

2. Check write access:
   ```bash
   gh repo view owner/repo --json viewerPermission
   ```

## Graphite Issues

### Missing Stack Metadata

**Symptoms:** `.graphite` is null for stack PRs

**Solutions:**

1. Ensure Graphite CLI is installed:
   ```bash
   gt --version
   ```

2. Re-sync (Graphite metadata is auto-detected):
   ```bash
   fw --refresh
   ```

3. Verify PR is in a Graphite stack:
   ```bash
   gt state
   ```

### Wrong File Provenance

**Symptoms:** `file_provenance.origin_pr` seems incorrect

**Solutions:**

1. Check stack state:
   ```bash
   gt log --files FILE_PATH
   ```

2. Re-sync with fresh data:
   ```bash
   fw --refresh full
   ```

### Restack Conflicts

**Symptoms:** `gt restack` fails with conflicts

**Solutions:**

1. Resolve conflicts in the failing PR
2. Complete the rebase:
   ```bash
   git add .
   gt restack --continue
   ```

3. If stuck, abort and retry:
   ```bash
   git rebase --abort
   gt restack
   ```

## Cache Issues

### Cache Location

Default: `~/.cache/firewatch/`

Check location:
```bash
fw status
```

### Clear Cache

```bash
rm -rf ~/.cache/firewatch/repos/*
```

### Cache Corruption

**Symptoms:** Parse errors, missing data, inconsistent results

**Solutions:**

```bash
# Clear and rebuild
rm -rf ~/.cache/firewatch/
fw --refresh
```

## Configuration Issues

### Config Location

- User: `~/.config/firewatch/config.toml`
- Project: `./.firewatch.toml`

### View Config

```bash
fw config
```

### Reset Config

```bash
rm ~/.config/firewatch/config.toml
```

## Getting Help

### Debug Mode

```bash
fw --debug
```

### Version Info

```bash
fw --version
```

### Report Issues

1. Run diagnostics: `fw doctor`
2. Check debug output
3. Report at: https://github.com/outfitter-dev/firewatch/issues
