import { run } from "@outfitter/firewatch-mcp";
import { Command } from "commander";

export const mcpCommand = new Command("mcp")
  .description("Start the MCP server for AI assistant integration")
  .option("--json", "Output JSON (default)")
  .action(async () => {
    await run();
  });
