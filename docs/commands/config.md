# fw config

Manage Firewatch configuration.

## Synopsis

```bash
fw config <command> [options]
```

## Subcommands

### show

Display current configuration.

```bash
fw config show [--json]
```

Shows both user config (`~/.config/firewatch/config.toml`) and project config (`.firewatch.toml`) if they exist.

### set

Set a configuration value.

```bash
fw config set <key> <value> [--local] [--json]
```

| Option | Description |
|--------|-------------|
| `--local` | Write to project config (`.firewatch.toml`) instead of user config |
| `--json` | Output JSON confirmation |

### path

Show configuration file paths.

```bash
fw config path [--json]
```

Displays paths for config files, cache, and data directories.

## Examples

```bash
# Show all configuration
fw config show

# Show as JSON
fw config show --json

# Set repositories to sync
fw config set repos "org/repo1,org/repo2"

# Set a GitHub token
fw config set github-token ghp_xxxx

# Enable Graphite by default
fw config set graphite-enabled true

# Enable stack output by default
fw config set default-stack true

# Set default time filter
fw config set default-since "7d"

# Set default PR states
fw config set default-states "open,draft"

# Set in project config (repo-local)
fw config set --local default-stack true

# Show file paths
fw config path
```

## Configuration Keys

| Key | Type | Description |
|-----|------|-------------|
| `repos` | array | Repositories to sync (`owner/repo` format) |
| `github-token` | string | GitHub personal access token |
| `graphite-enabled` | boolean | Enable Graphite integration |
| `default-stack` | boolean | Default to stack-grouped output |
| `default-since` | string | Default time filter (e.g., `7d`) |
| `default-states` | array | Default PR states filter |

Note: Keys use kebab-case in CLI but snake_case in config files.

## Output

### fw config show

```
# User config (~/.config/firewatch/config.toml)
repos = ["outfitter-dev/firewatch"]
graphite_enabled = true
default_stack = true
default_since = "7d"

# Project config (.firewatch.toml)
default_states = ["open", "draft"]
```

### fw config show --json

```json
{
  "user": {
    "path": "/Users/you/.config/firewatch/config.toml",
    "exists": true,
    "content": "repos = [\"outfitter-dev/firewatch\"]\n..."
  },
  "project": {
    "path": "/path/to/repo/.firewatch.toml",
    "exists": true,
    "content": "default_states = [\"open\", \"draft\"]\n"
  }
}
```

### fw config path

```
Config:  /Users/you/.config/firewatch/config.toml
Project: /path/to/repo/.firewatch.toml
Cache:   /Users/you/.cache/firewatch
Data:    /Users/you/.local/share/firewatch
Repos:   /Users/you/.cache/firewatch/repos
Meta:    /Users/you/.cache/firewatch/meta.jsonl
```

### fw config set (success)

```
Set repos = org/repo1,org/repo2
```

With `--json`:

```json
{"ok":true,"path":"/Users/you/.config/firewatch/config.toml","key":"repos","value":["org/repo1","org/repo2"]}
```

## File Locations

| File | Purpose |
|------|---------|
| `~/.config/firewatch/config.toml` | User configuration (global) |
| `.firewatch.toml` | Project configuration (repo root) |

Project config is auto-detected from the git root when running inside a repository.

## Precedence

Configuration is loaded in order (later overrides earlier):

1. Built-in defaults
2. User config (`~/.config/firewatch/config.toml`)
3. Project config (`.firewatch.toml`)

## See Also

- [Configuration Reference](../configuration.md) - Full documentation
- [Security](../../SECURITY.md) - Token handling
