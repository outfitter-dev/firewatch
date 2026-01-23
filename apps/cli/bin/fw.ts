#!/usr/bin/env bun

import { closeFirewatchDb } from "@outfitter/firewatch-core";

import { run } from "../src";

let shuttingDown = false;

/**
 * Performs graceful shutdown of database resources.
 * Ensures SQLite WAL is flushed and connections are closed.
 * Safe to call multiple times (idempotent).
 */
function shutdown(): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  closeFirewatchDb();
}

/**
 * Sets up graceful shutdown handlers for database cleanup.
 * Ensures SQLite WAL is flushed and connections are closed on:
 * - Normal process exit
 * - SIGINT (Ctrl+C)
 * - SIGTERM (kill command)
 * - Uncaught exceptions
 * - Unhandled promise rejections
 */
function setupShutdownHandlers(): void {
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
    console.error(
      "Uncaught exception:",
      err instanceof Error ? err.message : err
    );
    shutdown();
    process.exit(1);
  });

  // Unhandled promise rejections
  process.on("unhandledRejection", (reason) => {
    console.error(
      "Unhandled rejection:",
      reason instanceof Error ? reason.message : reason
    );
    shutdown();
    process.exit(1);
  });
}

setupShutdownHandlers();

(async () => {
  try {
    await run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    shutdown();
    process.exit(1);
  }
})();
