/**
 * Firewatch Core Library
 *
 * GitHub PR activity logger with pure JSONL output for jq-based workflows.
 */

// Authors
export {
  DEFAULT_BOT_PATTERNS,
  DEFAULT_EXCLUDE_AUTHORS,
  buildAuthorIndex,
  filterByAuthor,
  getAuthorStatsSorted,
  isBot,
  isExcludedAuthor,
  mergeExcludeAuthors,
  shouldExcludeAuthor,
  type AuthorFilterOptions,
  type AuthorStats,
} from "./authors";

// Auth
export { detectAuth, type AuthResult, type AuthSource } from "./auth";

// Cache
export {
  appendJsonl,
  deduplicateEntries,
  ensureDirectories,
  getRepoCachePath,
  parseRepoCacheFilename,
  PATHS,
  readEntriesJsonl,
  readJsonl,
  REPO_SEPARATOR,
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
  queryEntries,
  type QueryFilters,
  type QueryOptions,
} from "./query";

// Check
export { checkRepo, type CheckOptions, type CheckResult } from "./check";

// Worklist
export { buildWorklist, sortWorklist } from "./worklist";

// Time
export { parseSince } from "./time";

// Repo Detection
export { detectRepo, type RepoDetectResult } from "./repo-detect";

// Config
export {
  findProjectConfigPath,
  getConfigPaths,
  getProjectConfigPath,
  loadConfig,
  saveConfig,
} from "./config";

// Re-export schemas
export * from "./schema";

// Re-export plugin types
export type { FirewatchPlugin } from "./plugins/types";
