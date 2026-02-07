import type { McpToolResult } from "../types";

export function textResult(text: string): McpToolResult {
  return {
    content: [{ type: "text", text }],
  };
}

export function jsonLines(items: unknown[]): string {
  if (items.length === 0) {
    return "";
  }
  return items.map((item) => JSON.stringify(item)).join("\n");
}
