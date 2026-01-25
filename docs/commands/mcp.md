# fw mcp

Start the MCP server for AI assistant integration.

## Synopsis

```bash
fw mcp
```

## Description

The `mcp` command starts the Firewatch MCP (Model Context Protocol) server. The server communicates via stdio and is designed to be launched by MCP-compatible clients.

## Options

No options.

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

The MCP server exposes 6 tools with auth-gated write operations.

**Base tools (always available):**
- `fw_query` - Query cached PR activity (filters, summary output)
- `fw_status` - Cache and auth status
- `fw_doctor` - Diagnose auth/cache/repo issues
- `fw_help` - Usage docs, JSON schemas, config inspection

**Write tools (require authentication):**
- `fw_pr` - PR mutations (edit fields, manage metadata, submit reviews)
- `fw_fb` - Unified feedback (list, view, reply, ack, resolve)

See [MCP Server Documentation](../mcp.md) for full details.
