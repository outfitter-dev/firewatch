# Configuration Reference

Firewatch uses TOML configuration files with XDG-compliant paths.

## Configuration Files

| File | Purpose |
|------|---------|
| `~/.config/firewatch/config.toml` | User configuration (global) |
| `.firewatch.toml` | Project configuration (repo root) |

Project config is auto-detected from the git root when running inside a repository.

## Precedence

Configuration is loaded in order (later sources override earlier):

1. Built-in defaults
2. User config (`~/.config/firewatch/config.toml`)
3. Project config (`.firewatch.toml`)
4. Command-line options (highest priority)

## Duration Formats

Several configuration options and CLI flags accept duration strings for time-based filtering.

| Format | Example | Description |
|--------|---------|-------------|
| `Nh`   | `1h`, `24h` | Hours |
| `Nd`   | `7d`, `14d` | Days |
| `Nw`   | `1w`, `2w`  | Weeks (N * 7 days) |
| `Nm`   | `1m`, `3m`  | Months (N calendar months) |

Duration is calculated backwards from now. For example, `--since 7d` means "activity from the last 7 days".

**Examples:**
- `1h` - Last hour
- `24h` - Last 24 hours
- `7d` - Last 7 days
- `2w` - Last 2 weeks
- `1m` - Last month

Used in: `--since`, `default_since`, `lookout_stale_after`

## Configuration Options

### repos

List of repositories to sync.

| Property | Value |
|----------|-------|
| Type | `string[]` |
| Default | `[]` |
| Example | `["org/repo1", "org/repo2"]` |

```toml
repos = ["outfitter-dev/firewatch", "outfitter-dev/baselayer"]
```

When running `fw sync` without arguments, all configured repositories are synced.

### github_token

GitHub personal access token.

| Property | Value |
|----------|-------|
| Type | `string` |
| Default | (none) |
| Required | No (if using gh CLI) |

```toml
github_token = "ghp_xxxxxxxxxxxx"
```

**Recommendation**: Prefer using `gh auth login` instead of storing tokens in config. See [Authentication](#authentication).

### graphite_enabled

Enable Graphite integration globally.

| Property | Value |
|----------|-------|
| Type | `boolean` |
| Default | `false` |

```toml
graphite_enabled = true
```

When enabled, `fw sync` includes Graphite stack metadata for PRs in Graphite-managed repositories.

### default_stack

Default to stack-grouped output.

| Property | Value |
|----------|-------|
| Type | `boolean` |
| Default | `false` |

```toml
default_stack = true
```

Equivalent to always passing `--stack` to query commands.

### default_since

Default time filter for queries.

| Property | Value |
|----------|-------|
| Type | `string` |
| Default | (none) |
| Example | `"7d"`, `"24h"` |

```toml
default_since = "7d"
```

Equivalent to always passing `--since 7d`.

### default_states

Default PR states for queries.

| Property | Value |
|----------|-------|
| Type | `string[]` |
| Default | `["open", "draft"]` (when used) |
| Values | `"open"`, `"closed"`, `"merged"`, `"draft"` |

```toml
default_states = ["open", "draft"]
```

### max_prs_per_sync

Maximum PRs to fetch per sync operation.

| Property | Value |
|----------|-------|
| Type | `number` |
| Default | `100` |

```toml
max_prs_per_sync = 50
```

### lookout_stale_after

Staleness threshold for auto-sync before lookout.

| Property | Value |
|----------|-------|
| Type | `string` (duration) |
| Default | (none) |
| Example | `"1h"`, `"30m"` |

```toml
lookout_stale_after = "1h"
```

When set, `fw lookout` will auto-sync if the cache is older than this threshold.

## Environment Variables

### GITHUB_TOKEN / GH_TOKEN

GitHub personal access token. Checked if gh CLI authentication fails.

```bash
export GITHUB_TOKEN="ghp_xxxxxxxxxxxx"
```

### Standard XDG Variables

Firewatch respects XDG Base Directory Specification:

| Variable | Default | Usage |
|----------|---------|-------|
| `XDG_CONFIG_HOME` | `~/.config` | Config file location |
| `XDG_CACHE_HOME` | `~/.cache` | Cache file location |
| `XDG_DATA_HOME` | `~/.local/share` | Data file location |

## Authentication

Firewatch tries authentication sources in order:

1. **gh CLI** (recommended)
   ```bash
   gh auth login
   ```

2. **Environment variable**
   ```bash
   export GITHUB_TOKEN="ghp_xxxx"
   ```

3. **Config file**
   ```toml
   github_token = "ghp_xxxx"
   ```

### Required Scopes

| Operation | Scope |
|-----------|-------|
| Read (sync, query) | `repo` or `public_repo` |
| Write (comment, resolve) | `repo` |

## Cache Layout

```
~/.cache/firewatch/
├── repos/
│   └── b64~<encoded-repo>.jsonl    # Per-repo activity cache
└── meta.jsonl                       # Sync metadata

~/.config/firewatch/
└── config.toml                      # User configuration

<repo-root>/
└── .firewatch.toml                  # Project configuration
```

## Example Configurations

### Minimal User Config

```toml
# ~/.config/firewatch/config.toml
repos = ["org/main-repo"]
```

### Full User Config

```toml
# ~/.config/firewatch/config.toml

# Repositories to sync
repos = ["outfitter-dev/firewatch", "outfitter-dev/baselayer"]

# GitHub token (prefer gh CLI instead)
# github_token = "ghp_xxxx"

# Enable Graphite integration
graphite_enabled = true

# Default output settings
default_stack = true
default_since = "7d"
default_states = ["open", "draft"]

# Sync limits
max_prs_per_sync = 100

# Auto-sync for lookout
lookout_stale_after = "1h"
```

### Project Config

```toml
# .firewatch.toml (repo root)

# Project-specific defaults
default_stack = true
default_since = "7d"
default_states = ["open", "draft"]
```

### Team Config (Project)

```toml
# .firewatch.toml

# Shared team settings
default_states = ["open", "draft"]
default_since = "7d"

# Enable Graphite for the team
graphite_enabled = true
default_stack = true
```

## Managing Configuration

### View Configuration

```bash
# Show all config
fw config show

# Show as JSON
fw config show --json

# Show file paths
fw config path
```

### Set Values

```bash
# Set user config
fw config set repos "org/repo1,org/repo2"
fw config set default-since "7d"
fw config set graphite-enabled true

# Set project config
fw config set --local default-stack true
```

### Key Name Conversion

CLI uses kebab-case, config files use snake_case:

| CLI Key | Config Key |
|---------|------------|
| `repos` | `repos` |
| `github-token` | `github_token` |
| `graphite-enabled` | `graphite_enabled` |
| `default-stack` | `default_stack` |
| `default-since` | `default_since` |
| `default-states` | `default_states` |

## Best Practices

1. **Use gh CLI for authentication** - Avoid storing tokens in config files
2. **Use project config for team settings** - Share defaults via `.firewatch.toml`
3. **Keep secrets out of project config** - Never commit tokens
4. **Set sensible defaults** - `default_since` and `default_states` reduce typing

## See Also

- [fw config](./commands/config.md) - Configuration commands
- [Security](../SECURITY.md) - Token handling
