# fw config

View and edit Firewatch configuration.

## Synopsis

```bash
fw config                    # Show merged config
fw config <key>              # Show a specific key
fw config <key> <value>      # Set a value
fw config --edit             # Open config in $EDITOR
fw config --path             # Show config file paths
```

## Options

| Option | Description |
|--------|-------------|
| `--edit` | Open config in `$EDITOR` |
| `--path` | Show config file paths |
| `--local` | Target project config (`.firewatch.toml`) |
| `--json` | Force JSON output |
| `--no-json` | Force human-readable output |

## Key Format

Keys are dot-separated paths (matching the TOML structure):

- `repos`
- `sync.auto_sync`
- `sync.stale_threshold`
- `filters.exclude_authors`
- `filters.bot_patterns`
- `filters.exclude_bots`
- `output.default_format`
- `user.github_username`

Values are parsed as TOML where possible. Arrays can be set with TOML literals or comma-separated strings for common list keys.

## Examples

```bash
# Show all config
fw config

# Show specific value
fw config user.github_username

# Set username
fw config user.github_username galligan

# Set list values
fw config repos "[\"org/repo1\", \"org/repo2\"]"
fw config filters.exclude_authors "dependabot,renovate"

# Set sync threshold
fw config sync.stale_threshold "5m"

# Open in editor
fw config --edit

# Show config paths
fw config --path

# Write to project config
fw config --local filters.exclude_bots true
```
