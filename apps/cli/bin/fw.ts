#!/usr/bin/env bun

import { closeFirewatchDb } from "@outfitter/firewatch-core";

import { run } from "../src";

/**
 * Sets up graceful shutdown handlers for database cleanup.
 * Ensures SQLite WAL is flushed and connections are closed on:
 * - Normal process exit
 * - SIGINT (Ctrl+C)
 * - SIGTERM (kill command)
 * - Uncaught exceptions
 */
function setupShutdownHandlers(): void {
  let shuttingDown = false;

  const shutdown = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    closeFirewatchDb();
  };

  // Normal exit
  process.on("exit", shutdown);

  // Ctrl+C
  process.on("SIGINT", () => {
    shutdown();
    process.exit(0);
  });

  // kill command
  process.on("SIGTERM", () => {
    shutdown();
    process.exit(0);
  });

  // Uncaught exceptions
  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
    shutdown();
    process.exit(1);
  });
}

setupShutdownHandlers();
run();
