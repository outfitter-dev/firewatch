/**
 * Firewatch MCP Server (Future)
 *
 * Exposes core Firewatch functions as MCP tools for AI agent integration.
 *
 * Planned tools:
 * - firewatch_sync: Sync PR data from GitHub
 * - firewatch_query: Query cached PR activity
 * - firewatch_stack: Get Graphite stack for a PR
 */

// TODO: Implement MCP server when ready
// See: https://github.com/anthropics/anthropic-cookbook/tree/main/mcp

export const MCP_TOOLS = [
  {
    name: "firewatch_sync",
    description: "Sync PR data from GitHub",
    inputSchema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Repository in owner/repo format",
        },
        full: { type: "boolean", description: "Force full refresh" },
      },
      required: ["repo"],
    },
  },
  {
    name: "firewatch_query",
    description: "Query cached PR activity",
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Filter by repository" },
        pr: { type: "number", description: "Filter by PR number" },
        type: { type: "string", description: "Filter by type" },
        since: {
          type: "string",
          description: "Filter by time (e.g., 24h, 7d)",
        },
      },
    },
  },
  {
    name: "firewatch_stack",
    description: "Get Graphite stack for a PR",
    inputSchema: {
      type: "object",
      properties: {
        pr: { type: "number", description: "PR number" },
        repo: {
          type: "string",
          description: "Repository in owner/repo format",
        },
      },
      required: ["pr", "repo"],
    },
  },
] as const;
