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
  type ReactionContent,
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
export {
  detectRepo,
  getCurrentBranch,
  getPrForCurrentBranch,
  type BranchPrResult,
  type RepoDetectResult,
} from "./repo-detect";

// Config
export {
  applyEnvOverrides,
  findProjectConfigPath,
  getConfigPaths,
  getProjectConfigPath,
  loadConfig,
  parseConfigText,
  saveConfig,
  serializeConfigObject,
} from "./config";

// Ack (acknowledgement storage)
export {
  addAck,
  addAcks,
  clearAcks,
  getAckedIds,
  getAckFilePath,
  isAcked,
  readAcks,
  removeAck,
  type AckRecord,
} from "./ack";

// Short ID utilities
export {
  buildShortIdCache,
  classifyId,
  clearShortIdCache,
  formatShortId,
  generateShortId,
  getShortIdCacheSize,
  isFullCommentId,
  isPrNumber,
  isShortId,
  normalizeShortId,
  registerShortId,
  resolveId,
  resolveShortId,
  resolveShortIdFromEntries,
  stripShortIdPrefix,
  type IdType,
  type ResolvedId,
} from "./short-id";

// Parity
export {
  compareParityData,
  computeStats,
  filterComments,
  formatParityResult,
  type CommentStats,
  type CommentType,
  type IssueCommentStats,
  type ParityComment,
  type ParityData,
  type ParityDiscrepancy,
  type ParityFilterOptions,
  type ParityResult,
  type ParityStats,
} from "./parity";

// Batch utilities
export {
  batchAddReactions,
  buildAckRecords,
  deduplicateByCommentId,
  formatCommentId,
  partitionResolutions,
  resolveBatchIds,
  type BatchIdResolution,
  type BatchProcessResult,
  type BatchResolveOptions,
  type BuildAckRecordsOptions,
  type ReactionResult,
} from "./batch";

// Re-export schemas
export * from "./schema";

// Re-export plugin types
export type { FirewatchPlugin } from "./plugins/types";

// Stack providers
export {
  clearGraphiteCache,
  getStackProvider,
  getStackProviderByName,
  graphiteStackProvider,
  registerStackProvider,
  type Stack,
  type StackBranch,
  type StackDirection,
  type StackPosition,
  type StackProvider,
  type StackPRs,
} from "./stack";

// Render utilities
export {
  BOX,
  CATEGORY,
  CONTINUATION,
  SEPARATOR,
  STATUS,
  detectOutputTarget,
  detectViewport,
  formatDisplayId,
  isDisplayId,
  isTTY,
  normalizeWhitespace,
  padEnd,
  padStart,
  parseDisplayId,
  renderCategory,
  renderDivider,
  renderHeader,
  renderTree,
  truncate,
  wrapText,
  type HeaderLevel,
  type OutputTarget,
  type TreeNode,
  type TreeOptions,
  type Viewport,
} from "./render";
