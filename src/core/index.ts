/**
 * Firewatch Core Library
 *
 * GitHub PR activity logger with pure JSONL output for jq-based workflows.
 */

// Auth
export { detectAuth, type AuthResult, type AuthSource } from "./auth";

// Cache
export {
  appendJsonl,
  ensureDirectories,
  getRepoCachePath,
  PATHS,
  readJsonl,
  writeJsonl,
} from "./cache";

// GitHub
export {
  GitHubClient,
  PR_ACTIVITY_QUERY,
  type GraphQLResponse,
  type PRActivityData,
  type PRNode,
} from "./github";

// Sync
export { syncRepo, type SyncOptions, type SyncResult } from "./sync";

// Query
export {
  outputJsonl,
  parseSince,
  queryEntries,
  type QueryFilters,
  type QueryOptions,
} from "./query";

// Repo Detection
export { detectRepo, type RepoDetectResult } from "./repo-detect";

// Re-export schemas
export * from "../schema/entry";
export * from "../schema/config";
export * from "../plugins/types";
