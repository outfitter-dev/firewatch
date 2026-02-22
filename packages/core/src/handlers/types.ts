import type { Result } from "@outfitter/contracts";
import type { Logger } from "@outfitter/contracts/logging";
import type { Database } from "bun:sqlite";

import type { FirewatchConfig } from "../schema/config";

/**
 * Context passed to all Firewatch handlers.
 * Transport-agnostic -- CLI and MCP provide this.
 *
 * Intentionally distinct from the generic HandlerContext in the contracts package,
 * which lacks domain-specific fields like `db` (SQLite) and uses optional fields.
 * Firewatch handlers require all three fields.
 */
export interface HandlerContext {
  /** Firewatch configuration (loaded, not raw) */
  config: FirewatchConfig;
  /** Database handle for SQLite operations */
  db: Database;
  /** Structured logger */
  logger: Logger;
}

/**
 * A Firewatch handler function.
 * Takes typed input and context, returns a Result.
 */
export type Handler<TInput, TOutput, TError extends Error = Error> = (
  input: TInput,
  ctx: HandlerContext
) => Promise<Result<TOutput, TError>>;
