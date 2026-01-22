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
  closeFirewatchDb,
  ensureDirectories,
  getDatabase,
  getRepoCachePath,
  parseRepoCacheFilename,
  PATHS,
  readJsonl,
} from "./cache";

// Database
export {
  closeDatabase,
  CURRENT_SCHEMA_VERSION,
  getSchemaVersion,
  initSchema,
  migrateSchema,
  openDatabase,
} from "./db";

// Repository
export {
  clearRepo,
  countEntries,
  deleteEntriesByRepo,
  deletePR,
  deleteSyncMeta,
  getAllSyncMeta,
  getEntry,
  getPR,
  getPRsByState,
  getRepos,
  getSyncMeta,
  insertEntries,
  insertEntry,
  queryEntries as queryEntriesDb,
  rowToEntry,
  setSyncMeta,
  updateEntry,
  updatePRState,
  upsertPR,
  upsertPRs,
  type EntryUpdates,
  type PRMetadata,
} from "./repository";

// GitHub
export {
  GITHUB_PR_STATES,
  GitHubClient,
  PR_ACTIVITY_QUERY,
  type GitHubPRState,
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
export {
  checkRepo,
  checkRepoDb,
  type CheckOptions,
  type CheckResult,
} from "./check";

// Worklist
export { buildWorklist, sortWorklist } from "./worklist";

// Time
export { parseDurationMs, parseSince } from "./time";

// Repo Detection
export { detectRepo, type RepoDetectResult } from "./repo-detect";

// Config
export {
  findProjectConfigPath,
  getConfigPaths,
  getProjectConfigPath,
  loadConfig,
  parseConfigText,
  saveConfig,
  serializeConfigObject,
} from "./config";

// Re-export schemas
export * from "./schema";

// Re-export plugin types
export type { FirewatchPlugin } from "./plugins/types";
