# Configuration Reference

Firewatch uses TOML configuration files with XDG-compliant paths.

## Configuration Files

| File                              | Purpose                           |
| --------------------------------- | --------------------------------- |
| `~/.config/firewatch/config.toml` | User configuration (global)       |
| `.firewatch.toml`                 | Project configuration (repo root) |

Project config is auto-detected from the git root when running inside a repository.

## Precedence

Configuration is loaded in order (later sources override earlier):

1. Built-in defaults
2. User config (`~/.config/firewatch/config.toml`)
3. Project config (`.firewatch.toml`)
4. Command-line options (highest priority)

## Duration Formats

Duration formats vary by context:

### Config durations (stale_threshold)

| Format | Example | Description         |
| ------ | ------- | ------------------- |
| `Ns`   | `30s`   | Seconds             |
| `Nm`   | `15m`   | Minutes             |
| `Nh`   | `24h`   | Hours               |
| `Nd`   | `7d`    | Days                |
| `Nw`   | `2w`    | Weeks (N \* 7 days) |

### CLI --since flag

| Format | Example | Description               |
| ------ | ------- | ------------------------- |
| `Nh`   | `24h`   | Hours                     |
| `Nd`   | `7d`    | Days                      |
| `Nw`   | `2w`    | Weeks (N \* 7 days)       |
| `Nm`   | `3m`    | **Months** (not minutes!) |

> **Note:** The `--since` flag does NOT support seconds or minutes. Use `24h` for recent activity, not `30m` (which means 30 months).

Duration is calculated backwards from now. For example, `--since 7d` means "activity from the last 7 days".

## Configuration Options

### repos

List of repositories to sync.

| Property | Value                        |
| -------- | ---------------------------- |
| Type     | `string[]`                   |
| Default  | `[]`                         |
| Example  | `["org/repo1", "org/repo2"]` |

```toml
repos = ["outfitter-dev/firewatch", "outfitter-dev/baselayer"]
```

### github_token

GitHub personal access token.

| Property | Value                |
| -------- | -------------------- |
| Type     | `string`             |
| Default  | (none)               |
| Required | No (if using gh CLI) |

```toml
github_token = "ghp_xxxxxxxxxxxx"
```

**Recommendation**: Prefer using `gh auth login` instead of storing tokens in config. See [Authentication](#authentication).

### max_prs_per_sync

Maximum PRs to fetch per sync operation.

| Property | Value    |
| -------- | -------- |
| Type     | `number` |
| Default  | `100`    |

```toml
max_prs_per_sync = 100
```

### [sync]

Sync behavior.

| Key               | Type      | Default | Description                      |
| ----------------- | --------- | ------- | -------------------------------- |
| `auto_sync`       | `boolean` | `true`  | Auto-sync before queries         |
| `stale_threshold` | `string`  | `"5m"`  | Re-sync if cache older than this |

```toml
[sync]
auto_sync = true
stale_threshold = "5m"
```

### [filters]

Default filters applied to queries.

| Key               | Type       | Default | Description                           |
| ----------------- | ---------- | ------- | ------------------------------------- |
| `exclude_authors` | `string[]` | `[]`    | Authors to exclude (case-insensitive) |
| `bot_patterns`    | `string[]` | `[]`    | Regex patterns to treat as bots       |
| `exclude_bots`    | `boolean`  | `false` | Exclude bots by default               |

```toml
[filters]
# exclude_authors = ["specific-account"]  # exclude specific accounts if needed
# exclude_bots = true                      # disabled by default
# bot_patterns = ["^custom-bot$"]          # additional patterns to treat as bots
```

### [output]

Default output format.

| Key              | Type     | Default | Description       |
| ---------------- | -------- | ------- | ----------------- |
| `default_format` | `string` | (none)  | `human` or `json` |

```toml
[output]
default_format = "human"
```

### [user]

User context for perspective filters.

| Key               | Type     | Default | Description                     |
| ----------------- | -------- | ------- | ------------------------------- |
| `github_username` | `string` | (none)  | Used for `--mine` / `--reviews` |

```toml
[user]
github_username = "galligan"
```

## Environment Variables

### GITHUB_TOKEN / GH_TOKEN

GitHub personal access token. Checked if gh CLI authentication fails.

```bash
export GITHUB_TOKEN="ghp_xxxxxxxxxxxx"
```

### Standard XDG Variables

Firewatch respects XDG Base Directory Specification:

| Variable          | Default          | Usage                |
| ----------------- | ---------------- | -------------------- |
| `XDG_CONFIG_HOME` | `~/.config`      | Config file location |
| `XDG_CACHE_HOME`  | `~/.cache`       | Cache file location  |
| `XDG_DATA_HOME`   | `~/.local/share` | Data file location   |

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

| Operation                 | Scope                   |
| ------------------------- | ----------------------- |
| Read (query/sync)         | `repo` or `public_repo` |
| Write (add/close/edit/rm) | `repo`                  |

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
repos = ["outfitter-dev/firewatch", "outfitter-dev/baselayer"]
max_prs_per_sync = 100

[user]
github_username = "galligan"

[sync]
auto_sync = true
stale_threshold = "5m"

# [filters]
# exclude_authors = ["specific-account"]  # if needed

[output]
default_format = "human"
```

### Project Config

```toml
# .firewatch.toml

[sync]
stale_threshold = "2m"

# [filters]
# exclude_authors = ["specific-account"]  # if needed
```

## Managing Configuration

```bash
# Show all config
fw config

# Show specific value
fw config user.github_username

# Set value
fw config user.github_username galligan

# Open in editor
fw config --edit

# Show file paths
fw config --path
```

## See Also

- [fw config](./commands/config.md) - Configuration commands
- [Security](../SECURITY.md) - Token handling
