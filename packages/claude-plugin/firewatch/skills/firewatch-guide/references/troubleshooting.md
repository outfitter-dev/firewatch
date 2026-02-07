# Firewatch CLI Troubleshooting

Quick reference for diagnosing and resolving common Firewatch issues.

## Diagnostic Commands

| Command             | Purpose                           |
| ------------------- | --------------------------------- |
| `fw doctor`         | Diagnose auth, cache, repo issues |
| `fw doctor --fix`   | Auto-repair common problems       |
| `fw status`         | Show auth, cache, config state    |
| `fw status --short` | Compact status output             |

## Setup Checklist

Run through these checks when setting up Firewatch:

```bash
# 1. Verify authentication is working
fw doctor

# 2. Confirm repo is detected (run from repo directory)
fw status --short

# 3. Test a basic query
fw --since 7d
```

Expected output from `fw doctor`:

- Auth: OK (shows auth method)
- Cache: OK (shows path, writable)
- Repo: OK (shows detected owner/repo)

## Authentication Issues

### Auth Chain Priority

Firewatch tries authentication sources in order:

1. **gh CLI** (preferred) - Uses `gh auth token`
2. **GITHUB_TOKEN env** - Environment variable
3. **Config file** - Token in `~/.config/firewatch/config.toml`

### Diagnosing Auth Problems

```bash
# Check gh CLI auth status
gh auth status

# Verify token has required scopes
gh auth status --show-token

# Test Firewatch auth specifically
fw doctor
```

### Setting Token Manually

If gh CLI is unavailable:

```bash
# Option 1: Environment variable
export GITHUB_TOKEN="ghp_xxxxxxxxxxxx"

# Option 2: Config file
fw config set token ghp_xxxxxxxxxxxx
```

Required token scopes:

- `repo` - Full repository access
- `read:org` - Read org membership (for private repos)

## Cache Issues

### Cache Location

Default XDG-compliant paths:

- **macOS**: `~/.cache/firewatch/`
- **Linux**: `~/.cache/firewatch/`
- **Windows**: `%LOCALAPPDATA%/firewatch/Cache/`

### Cache Files

```
~/.cache/firewatch/
├── repos/
│   └── owner-repo.jsonl    # Per-repo activity entries
└── meta.jsonl              # Sync state with cursors
```

### Cache Operations

```bash
# View cache status
fw status

# Clear all cached data
fw cache clear

# Prune old entries (keeps recent)
fw cache prune

# Force fresh sync (ignores cache)
fw sync --force
```

### Cache Not Writable

If cache directory is not writable:

```bash
# Check permissions
ls -la ~/.cache/firewatch/

# Fix permissions
chmod 755 ~/.cache/firewatch/
chmod 644 ~/.cache/firewatch/*.jsonl

# Or remove and let Firewatch recreate
rm -rf ~/.cache/firewatch/
fw sync owner/repo
```

## Repo Detection Issues

### How Detection Works

Firewatch auto-detects repositories by checking:

1. Git remote origin URL
2. Current directory context

### Manual Repo Specification

When auto-detection fails:

```bash
# Specify repo explicitly
fw --repo owner/repo --since 24h

# Or for any command
fw sync owner/repo
fw query --repo owner/repo
```

### Common Detection Problems

**"No repository detected"**

- Not in a git repository
- No remote named `origin`
- Remote URL format not recognized

```bash
# Check git remote
git remote -v

# Should show GitHub URL
# origin  git@github.com:owner/repo.git (fetch)
# or
# origin  https://github.com/owner/repo.git (fetch)
```

## Graphite Integration

### Checking Graphite Setup

```bash
# Verify gt CLI is installed
which gt
gt --version

# Check Graphite authentication
gt auth status
```

### Stack Detection Issues

Graphite stack metadata requires:

- `gt` CLI installed and authenticated
- Repository initialized with Graphite (`gt init`)
- Branches tracked by Graphite

```bash
# Verify stack is tracked
gt stack

# Re-initialize if needed
gt init
```

### Disabling Graphite Integration

If Graphite causes issues:

```bash
# Query without Graphite enrichment
fw query --no-graphite
```

## Common Errors

### "No repository detected"

**Cause**: Not in a git repo or no recognizable remote.

**Fix**:

```bash
# Navigate to repo directory
cd /path/to/repo

# Or specify manually
fw --repo owner/repo query
```

### "Auth failed" / "401 Unauthorized"

**Cause**: Invalid or expired token, missing scopes.

**Fix**:

```bash
# Re-authenticate with gh CLI
gh auth login

# Or check/refresh token
gh auth status
gh auth refresh
```

### "Rate limited" / "403 rate limit exceeded"

**Cause**: Too many API requests.

**Fix**:

```bash
# Check rate limit status
gh api rate_limit

# Wait for reset (shown in response)
# Or use authenticated requests (higher limits)
gh auth status
```

### "Cache not writable"

**Cause**: Permission issues or disk full.

**Fix**:

```bash
# Check disk space
df -h ~/.cache

# Fix permissions
chmod -R u+rw ~/.cache/firewatch/

# Or clear and recreate
rm -rf ~/.cache/firewatch/
```

### "GraphQL query failed"

**Cause**: API error, often due to large queries or invalid parameters.

**Fix**:

```bash
# Try with smaller time window
fw --since 24h

# Check for specific error in verbose output
fw --verbose query
```

## MCP Server Issues

### Starting the MCP Server

```bash
# Start MCP server
fw mcp

# Or run directly
bun apps/mcp/bin/fw-mcp.ts
```

### Write Tools Not Available

MCP write operations (add, edit, close, rm) require authentication.

**Symptoms**: Tools return "auth required" or "read-only mode".

**Fix**:

```bash
# Ensure auth is configured before starting MCP
fw doctor

# In MCP calls, use recheck_auth to refresh
{"action": "status", "recheck_auth": true}
```

### MCP Connection Issues

If Claude Code cannot connect to MCP server:

1. Verify server is running: `fw mcp` in a terminal
2. Check for port conflicts
3. Review MCP configuration in Claude settings

### Debugging MCP

```bash
# Test MCP actions via CLI
fw mcp --test '{"action": "status"}'

# Check MCP server logs
fw mcp --verbose
```

## Getting Help

```bash
# General help
fw --help

# Command-specific help
fw query --help
fw sync --help

# Schema for output formats
fw schema
fw schema --type worklist
```

## Reporting Issues

When reporting bugs, include:

```bash
# System info
fw doctor --verbose

# Version info
fw --version

# Reproduce with verbose output
fw --verbose <command that failed>
```

File issues at: https://github.com/outfitter-dev/firewatch/issues
