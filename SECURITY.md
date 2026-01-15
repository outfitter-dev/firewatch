# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in Firewatch, please report it responsibly:

1. **Do not** open a public issue
2. Email security concerns to the maintainers directly
3. Include a detailed description of the vulnerability
4. Provide steps to reproduce if possible

We will acknowledge receipt within 48 hours and provide a timeline for resolution.

## Security Considerations

### Token Handling

Firewatch handles GitHub authentication tokens. Here's how tokens are managed:

#### Authentication Chain

Firewatch tries authentication sources in this order:

1. **gh CLI** (recommended): Uses existing `gh auth` session
2. **Environment variable**: `GITHUB_TOKEN` or `GH_TOKEN`
3. **Config file**: `github_token` in `~/.config/firewatch/config.toml`

#### Best Practices

- **Prefer gh CLI**: Let `gh auth login` manage your token
- **Avoid storing tokens in config**: If you must, ensure proper file permissions
- **Use fine-grained tokens**: Create tokens with minimal required scopes
- **Never commit tokens**: The `.firewatch.toml` project config should not contain tokens

#### Required Token Scopes

For read operations:
- `repo` (for private repositories)
- `public_repo` (for public repositories only)

For write operations (`add`, `close`, `edit`, `rm`):
- `repo` scope is required

### Cache Security

#### Cache Location

Firewatch stores cached data in XDG-compliant directories:

```
~/.cache/firewatch/
├── repos/           # Per-repo JSONL activity cache
└── meta.jsonl       # Sync state metadata
```

#### What's Cached

- PR metadata (titles, authors, branches, labels)
- Comments and review content
- Commit information
- CI status events

#### Considerations

- Cache contains PR content from repositories you've synced
- May include sensitive information from private repositories
- Cache files are stored with default user permissions
- Clear cache manually if needed: `rm -rf ~/.cache/firewatch`

### Network Security

- All GitHub API calls use HTTPS
- GraphQL queries are sent to `api.github.com`
- No telemetry or analytics data is collected

### MCP Server

When running as an MCP server:

- Communicates via stdio (local only)
- Inherits authentication from CLI configuration
- Has full read/write access to cached repositories
- Can post comments/reviews, resolve threads, and update PR metadata on your behalf

Ensure MCP clients are trusted before granting access.

## Secure Configuration Example

```toml
# ~/.config/firewatch/config.toml

# List repos to sync (no secrets here)
repos = ["org/repo1", "org/repo2"]

# Output defaults
[output]
default_format = "human"

# DO NOT store tokens here if avoidable
# Prefer: gh auth login
```

## Dependencies

Firewatch uses minimal dependencies:

- `zod` for schema validation
- `commander` for CLI parsing
- `@modelcontextprotocol/sdk` for MCP server
- No network requests outside GitHub API

Run `bun audit` to check for known vulnerabilities in dependencies.
