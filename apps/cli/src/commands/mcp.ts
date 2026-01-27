import { run } from "@outfitter/firewatch-mcp";
import { Command } from "commander";

export const mcpCommand = new Command("mcp")
  .description("Start the MCP server for AI assistant integration")
  .option("--debug", "Enable debug logging")
  .option("--no-color", "Disable color output")
  .action(async () => {
    await run();
  });
