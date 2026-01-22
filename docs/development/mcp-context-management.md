# MCP Context Management: Tool Search and Dynamic Updates

This document covers Claude Code's MCP features for managing tool context overhead, with a focus on splitting unified tools into multiple focused tools while staying under token limits.

## Overview

When building MCP servers, tool definitions consume context tokens. For servers with many tools or complex schemas, this can quickly exceed reasonable limits. Claude Code provides two key features to address this:

1. **MCP Tool Search** - Dynamically loads tools on-demand instead of preloading all of them
2. **Dynamic Tool Updates** - Allows tools to be updated at runtime without reconnection

## MCP Tool Search

### What It Is

Tool Search solves the context overhead problem by deferring tool loading until they're needed. Instead of loading all tool definitions upfront, Claude Code:

1. Defers MCP tools rather than loading them into context
2. Provides Claude with a search tool to discover relevant MCP tools when needed
3. Only loads the tools Claude actually needs into context
4. MCP tools continue to work exactly as before from the user's perspective

### How It Works

**Automatic activation**: Tool Search automatically enables when your MCP tool descriptions would consume more than 10% of the context window.

**The flow**:

```
Without Tool Search:
┌─────────────────────────────────────┐
│ Context Window                      │
├─────────────────────────────────────┤
│ All 50 tools loaded (5000 tokens)  │  ← Context consumed upfront
│ User prompt                         │
│ Claude response                     │
└─────────────────────────────────────┘

With Tool Search:
┌─────────────────────────────────────┐
│ Context Window                      │
├─────────────────────────────────────┤
│ MCPSearch tool (100 tokens)        │  ← Minimal overhead
│ User prompt                         │
│ Claude searches for relevant tools  │  ← Dynamic discovery
│ Only 3 tools loaded (300 tokens)   │  ← Load what's needed
│ Claude response                     │
└─────────────────────────────────────┘
```

### Configuration

Control Tool Search behavior with the `ENABLE_TOOL_SEARCH` environment variable:

| Value      | Behavior                                                 |
| ---------- | -------------------------------------------------------- |
| `auto`     | Activates when MCP tools exceed 10% of context (default) |
| `auto:<N>` | Activates at custom threshold (e.g., `auto:5` for 5%)    |
| `true`     | Always enabled                                           |
| `false`    | Disabled, all MCP tools loaded upfront                   |

**Examples**:

```bash
# Use a custom 5% threshold
ENABLE_TOOL_SEARCH=auto:5 claude

# Disable tool search entirely
ENABLE_TOOL_SEARCH=false claude

# Always enable (regardless of tool count)
ENABLE_TOOL_SEARCH=true claude
```

You can also set this in `settings.json`:

```json
{
  "env": {
    "ENABLE_TOOL_SEARCH": "auto:5"
  }
}
```

Or disable the MCPSearch tool specifically:

```json
{
  "permissions": {
    "deny": ["MCPSearch"]
  }
}
```

### Model Requirements

Tool Search requires models that support `tool_reference` blocks:

- ✅ Sonnet 4 and later
- ✅ Opus 4 and later
- ❌ Haiku models (do not support tool search)

### For MCP Server Authors

When Tool Search is enabled, **server instructions become critical**. They work like skill descriptions, helping Claude understand when to search for your tools.

**Good server instructions**:

```json
{
  "name": "firewatch",
  "instructions": "Query GitHub PR activity including reviews, comments, commits, and CI status. Use when checking PR status, finding review comments, querying activity, resolving feedback, or working with GitHub pull requests. Outputs JSONL for jq composition."
}
```

**What to include**:

- Category of tasks your tools handle
- When Claude should search for your tools
- Key capabilities your server provides
- Common use cases or trigger words

**Poor server instructions**:

```json
{
  "name": "firewatch",
  "instructions": "GitHub tools" // Too vague
}
```

## Dynamic Tool Updates

### What It Is

Claude Code supports MCP `list_changed` notifications, allowing MCP servers to dynamically update their available tools, prompts, and resources without requiring users to disconnect and reconnect.

### How It Works

When an MCP server sends a `list_changed` notification, Claude Code automatically refreshes the available capabilities from that server.

**Use cases**:

- User authenticates → unlock additional tools
- Configuration changes → expose new tools
- Feature flags toggled → enable/disable tools
- Context-dependent tools → show tools based on current state

**Example flow**:

```
1. User connects to MCP server
   → Server exposes: query, status (public tools)

2. User runs: /mcp (authenticates)
   → Server sends list_changed notification
   → Server now exposes: query, status, add, edit, close (authenticated tools)

3. Claude Code automatically refreshes tool list
   → New tools available immediately
```

### Implementation Pattern

**Server-side** (conceptual):

```typescript
// When state changes that affects available tools
async function onAuthenticationSuccess() {
  // Update internal tool registry
  this.tools = [...publicTools, ...authenticatedTools];

  // Notify Claude Code
  await this.sendNotification({
    method: "notifications/tools/list_changed",
  });
}
```

**Client-side**: Claude Code handles this automatically. No user action required.

## Splitting Unified Tools: A Strategy Guide

### The Problem

A unified tool with an `action` parameter is simple to implement but can bloat context:

```json
{
  "name": "firewatch",
  "description": "...",
  "inputSchema": {
    "properties": {
      "action": {
        "enum": [
          "query",
          "add",
          "close",
          "edit",
          "rm",
          "status",
          "config",
          "doctor",
          "schema",
          "help"
        ]
      }
      // ... 50+ properties for all actions combined
    }
  }
}
```

**Token consumption**: This single tool might consume 2000+ tokens describing all actions and properties.

### The Solution: Multiple Focused Tools + Tool Search

Split into focused tools that Tool Search loads on-demand:

```json
{
  "name": "firewatch_query",
  "description": "Filter and query cached PR activity",
  "inputSchema": {
    "properties": {
      "since": { "type": "string" },
      "type": { "enum": ["review", "comment", "commit"] }
      // ... only query-relevant properties
    }
  }
}

{
  "name": "firewatch_add",
  "description": "Add comments, reviews, or metadata to PRs",
  "inputSchema": {
    "properties": {
      "pr": { "type": "number" },
      "body": { "type": "string" }
      // ... only add-relevant properties
    }
  }
}

// ... more focused tools
```

**Token consumption with Tool Search**:

- **Without search**: All 10 tools loaded upfront = ~3000 tokens
- **With search**: MCPSearch tool = ~100 tokens, then 1-2 tools loaded on-demand = ~400 tokens total
- **Savings**: ~2600 tokens (87% reduction)

### Design Patterns

#### Pattern 1: Action-Based Split

Split by CRUD operations:

- `firewatch_query` - Read operations
- `firewatch_add` - Create operations
- `firewatch_edit` - Update operations
- `firewatch_delete` - Delete operations
- `firewatch_status` - Status/metadata operations

#### Pattern 2: Domain-Based Split

Split by subject matter:

- `firewatch_reviews` - Review comments and threads
- `firewatch_commits` - Commit activity
- `firewatch_ci` - CI status and checks
- `firewatch_metadata` - PR fields, labels, assignees
- `firewatch_config` - Configuration management

#### Pattern 3: Hybrid Split

Combine frequent operations, split rare ones:

- `firewatch_query` - Common read operations (query, status)
- `firewatch_write` - Common write operations (add, edit)
- `firewatch_admin` - Rare operations (config, doctor, schema)

### Keeping Under 3k Tokens

**Token budget breakdown** (rough estimates):

| Component           | Tokens  | Notes                           |
| ------------------- | ------- | ------------------------------- |
| Tool name           | 5-10    | Short, descriptive              |
| Description         | 50-100  | Clear use case                  |
| Input schema        | 100-500 | Per tool, depends on complexity |
| Server instructions | 50-150  | Once per server, not per tool   |

**Target**: 6-10 focused tools × 200 tokens each = 1200-2000 tokens (with search: ~100 tokens)

**Optimization strategies**:

1. **Concise descriptions**: Focus on when to use, not implementation details

   ```json
   // ❌ Verbose (80 tokens)
   "description": "This tool queries the cached GitHub PR activity data that has been synchronized from the GitHub API. It supports filtering by time ranges, activity types, and PR numbers. The output is in JSONL format suitable for piping to jq for further processing."

   // ✅ Concise (30 tokens)
   "description": "Query cached PR activity. Filter by time, type, or PR number. Outputs JSONL for jq."
   ```

2. **Shared types**: Use `$ref` for common schemas

   ```json
   {
     "definitions": {
       "prNumber": { "type": "number", "minimum": 1 }
     },
     "tools": {
       "firewatch_query": {
         "inputSchema": {
           "properties": {
             "pr": { "$ref": "#/definitions/prNumber" }
           }
         }
       }
     }
   }
   ```

3. **Minimal enums**: Only include commonly used values

   ```json
   // ❌ Exhaustive enum (adds tokens)
   "type": { "enum": ["review", "comment", "commit", "ci", "review_comment", "issue_comment", "commit_comment"] }

   // ✅ Core enum + string fallback
   "type": { "enum": ["review", "comment", "commit"], "type": "string" }
   ```

4. **Server instructions over tool descriptions**: Put common context in server instructions once
   ```json
   {
     "serverInstructions": "All tools output JSONL. Use jq for filtering. Cache is auto-synced.",
     "tools": {
       "firewatch_query": {
         "description": "Query PR activity" // Don't repeat JSONL/jq info
       }
     }
   }
   ```

## Best Practices

### When to Use Unified Tools

Keep a unified tool with `action` parameter when:

- Total tool definition < 1000 tokens
- Actions are tightly coupled
- You're prototyping/MVP stage
- Users commonly need multiple actions together

### When to Split Tools

Split into multiple tools when:

- Tool definition > 1500 tokens
- Actions are independent
- Different authentication levels per action
- You want fine-grained usage analytics
- Token budget is constrained

### Progressive Enhancement Strategy

1. **Start unified**: Build a single tool with action parameter
2. **Measure**: Check token consumption (`/mcp` in Claude Code shows tool sizes)
3. **Split if needed**: When approaching 2k tokens, split into focused tools
4. **Enable Tool Search**: Let Claude Code load tools on-demand
5. **Optimize**: Refine descriptions and schemas based on usage

### Testing Tool Search

Verify Tool Search is working:

```bash
# Start with Tool Search enabled
ENABLE_TOOL_SEARCH=true claude

# In Claude Code:
> /mcp
# Look for "Tool Search: Enabled" or similar indicator

# Verify tools aren't loaded upfront
> "List all available firewatch tools"
# Claude should search first, then list
```

## Migration Example: Firewatch

### Before (Unified Tool)

```json
{
  "name": "firewatch",
  "description": "Query GitHub PR activity, add comments, resolve threads, edit PRs, remove metadata, check status, manage config, run diagnostics, and view schemas. Outputs JSONL for jq composition.",
  "inputSchema": {
    "type": "object",
    "required": ["action"],
    "properties": {
      "action": {
        "enum": [
          "query",
          "add",
          "close",
          "edit",
          "rm",
          "status",
          "config",
          "doctor",
          "schema",
          "help"
        ]
      },
      "pr": { "type": "number" },
      "since": { "type": "string" },
      "type": { "enum": ["review", "comment", "commit", "ci"] },
      "body": { "type": "string" },
      "comment_id": { "type": "string" },
      "title": { "type": "string" },
      "state": { "enum": ["open", "closed", "draft"] },
      "label": { "type": "string" },
      "reviewer": { "type": "string" },
      "assignee": { "type": "string" },
      "milestone": { "type": "string" },
      "status_short": { "type": "boolean" },
      "config_key": { "type": "string" },
      "config_value": { "type": "string" },
      "summary": { "type": "boolean" },
      "summary_short": { "type": "boolean" }
      // ... more properties
    }
  }
}
```

**Token estimate**: ~2500 tokens

### After (Split Tools)

**Server instructions** (once):

```json
{
  "instructions": "Query GitHub PR activity including reviews, comments, commits, and CI status. Use when checking PR status, finding review comments, querying activity, resolving feedback, or working with GitHub pull requests. All tools output JSONL for jq composition. Cache auto-syncs if stale."
}
```

**Individual tools**:

```json
{
  "name": "firewatch_query",
  "description": "Filter cached PR activity by time, type, or PR number",
  "inputSchema": {
    "properties": {
      "pr": { "type": "number" },
      "since": { "type": "string" },
      "type": { "enum": ["review", "comment", "commit"] },
      "summary": { "type": "boolean" }
    }
  }
}

{
  "name": "firewatch_add",
  "description": "Add comments or reviews to PRs",
  "inputSchema": {
    "required": ["pr", "body"],
    "properties": {
      "pr": { "type": "number" },
      "body": { "type": "string" },
      "reply_to": { "type": "string" },
      "resolve": { "type": "boolean" }
    }
  }
}

{
  "name": "firewatch_status",
  "description": "Show cache status and sync state",
  "inputSchema": {
    "properties": {
      "short": { "type": "boolean" }
    }
  }
}

// ... 5-7 more focused tools
```

**Token estimate with Tool Search**:

- Server instructions: ~100 tokens
- MCPSearch tool: ~100 tokens
- 2-3 tools loaded on-demand: ~600 tokens
- **Total**: ~800 tokens (68% reduction)

## Combining Both Features

Use Dynamic Tool Updates + Tool Search together:

```typescript
class FirewatchMCP {
  private authenticatedTools = ["firewatch_query", "firewatch_status"];

  private adminTools = [
    "firewatch_add",
    "firewatch_edit",
    "firewatch_close",
    "firewatch_rm",
    "firewatch_config",
  ];

  async onAuthenticate() {
    // Unlock admin tools
    this.availableTools = [...this.authenticatedTools, ...this.adminTools];

    // Notify Claude Code (triggers tool list refresh)
    await this.sendNotification({
      method: "notifications/tools/list_changed",
    });

    // Tool Search ensures only needed admin tools load
  }
}
```

**Result**:

- Before auth: 2 tools available, ~200 tokens
- After auth: 8 tools available, but Tool Search loads ~300 tokens on-demand
- Context efficient AND secure

## Monitoring and Debugging

### Check Tool Token Usage

```bash
# In Claude Code
> /mcp

# Look for:
# - Total tool tokens
# - Tool Search status
# - Individual tool sizes
```

### Verify Tool Search Activation

Check environment:

```bash
echo $ENABLE_TOOL_SEARCH  # Should show "auto" or threshold
```

Check settings:

```json
// ~/.claude.json or settings.json
{
  "env": {
    "ENABLE_TOOL_SEARCH": "auto:5"
  }
}
```

### Test Dynamic Updates

1. Connect to MCP server
2. List available tools
3. Trigger state change (e.g., authenticate)
4. List tools again - should see new tools without reconnecting

## References

- [Claude Code MCP Documentation](https://code.claude.com/docs/en/mcp)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/)
- [MCP Tool Search Section](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search)
- [Dynamic Tool Updates Section](https://code.claude.com/docs/en/mcp#dynamic-tool-updates)

## Related Documents

- [MCP Integration](./mcp-integration.md) - General MCP server implementation
- [GitHub Integration](./github-integration.md) - GitHub API patterns
- [Architecture Overview](../architecture.md) - System design
