# fw mcp

Start the MCP server for AI assistant integration.

## Synopsis

```bash
fw mcp
```

## Description

The `mcp` command starts the Firewatch MCP (Model Context Protocol) server. The server communicates via stdio and is designed to be launched by MCP-compatible clients.

## Options

| Option | Description |
|--------|-------------|
| `--json` | Output JSON (default, included for consistency) |

## Examples

```bash
# Start the MCP server
fw mcp
```

## Configuration

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "firewatch": {
      "command": "fw",
      "args": ["mcp"]
    }
  }
}
```

## Server Capabilities

The MCP server exposes a single `firewatch` tool with actions:

- `query` - Filter cached entries (supports summary output)
- `add` - Add comments/reviews or metadata
- `close` - Resolve review threads
- `edit` - Update PR fields or draft/ready
- `rm` - Remove labels/reviewers/assignees/milestone
- `status` - Firewatch state info
- `config` - Read config (read-only)
- `doctor` - Diagnose setup
- `schema` - Schema documentation
- `help` - Usage help

See [MCP Server Documentation](../mcp.md) for full details.
