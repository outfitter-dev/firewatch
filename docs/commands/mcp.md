# fw mcp

Start the MCP server for AI assistant integration.

## Synopsis

```bash
fw mcp
```

## Description

The `mcp` command starts the Firewatch MCP (Model Context Protocol) server. This server allows AI assistants to query and interact with PR activity data through a standardized protocol.

The server communicates via stdio and is designed to be launched by MCP-compatible clients like Claude Desktop or other AI assistants.

## Options

| Option | Description |
|--------|-------------|
| `--json` | Output JSON (default, included for consistency) |

## Examples

```bash
# Start the MCP server
fw mcp

# The server runs until terminated (Ctrl+C)
```

## Configuration

To use with Claude Desktop or other MCP clients, add to your MCP configuration:

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

Or with an absolute path to the binary:

```json
{
  "mcpServers": {
    "firewatch": {
      "command": "/path/to/fw",
      "args": ["mcp"]
    }
  }
}
```

## Server Capabilities

The MCP server exposes a single `firewatch` tool with the following actions:

- `query` - Filter cached PR activity entries
- `sync` - Fetch PR data from GitHub
- `status` - Get PR activity summary
- `check` - Refresh staleness hints
- `comment` - Post a comment or reply
- `resolve` - Resolve review threads
- `schema` - Get schema documentation
- `help` - Get usage help

## See Also

- [MCP Server Documentation](../mcp.md) - Full MCP protocol documentation
- [Configuration](../configuration.md) - Authentication setup
