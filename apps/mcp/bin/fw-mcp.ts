#!/usr/bin/env bun
import { closeFirewatchDb } from "@outfitter/firewatch-core";

import { version } from "../package.json";
import { run } from "../src/index";

const HELP_TEXT = `Firewatch MCP Server v${version}

Usage: fw-mcp [options]

Options:
  -h, --help     Show this help message
  -v, --version  Show version number

Description:
  Starts the Firewatch MCP server using stdio transport.
  This server exposes GitHub PR activity tools for AI agents.

Tools provided:
  fw_query   Query cached PR activity (filters, summaries)
  fw_status  Cache and auth status
  fw_doctor  Diagnose and fix issues
  fw_help    Usage documentation
  fw_pr      PR mutations (requires auth)
  fw_fb      Feedback operations (requires auth)

Example MCP client config:
  {
    "mcpServers": {
      "firewatch": {
        "command": "fw-mcp"
      }
    }
  }

For more information: https://github.com/outfitter-dev/firewatch
`;

function parseArgs(): { help: boolean; version: boolean } {
  const args = new Set(process.argv.slice(2));
  return {
    help: args.has("-h") || args.has("--help"),
    version: args.has("-v") || args.has("--version"),
  };
}

function setupShutdownHandlers(): void {
  let shuttingDown = false;

  const shutdown = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    closeFirewatchDb();
  };

  process.on("exit", shutdown);

  process.on("SIGINT", () => {
    shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    shutdown();
    process.exit(0);
  });

  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
    shutdown();
    process.exit(1);
  });
}

const { help, version: showVersion } = parseArgs();

if (help) {
  console.log(HELP_TEXT);
  process.exit(0);
}

if (showVersion) {
  console.log(version);
  process.exit(0);
}

setupShutdownHandlers();
run();
