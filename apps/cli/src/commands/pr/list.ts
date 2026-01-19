import {
  ENTRY_TYPES,
  GitHubClient,
  PATHS,
  countEntries,
  detectAuth,
  detectRepo,
  ensureDirectories,
  getAllSyncMeta,
  getDatabase,
  getSyncMeta,
  loadConfig,
  mergeExcludeAuthors,
  parseDurationMs,
  parseSince,
  parseRepoCacheFilename,
  queryEntries,
  syncRepo,
  type FirewatchConfig,
  type FirewatchEntry,
} from "@outfitter/firewatch-core";
import {
  getGraphiteStacks,
  graphitePlugin,
} from "@outfitter/firewatch-core/plugins";
import { Command } from "commander";
import { existsSync, readdirSync } from "node:fs";
import ora from "ora";

import { buildActionableSummary, printActionableSummary } from "../../actionable";
import { validateRepoFormat } from "../../repo";
import { ensureGraphiteMetadata } from "../../stack";
import { writeJsonLine } from "../../utils/json";
import { resolveStates } from "../../utils/states";
import { shouldOutputJson } from "../../utils/tty";
import { outputWorklist } from "../../worklist";

interface ListCommandOptions {
  prs?: string | boolean;
  repo?: string;
  all?: boolean;
  mine?: boolean;
  reviews?: boolean;
  open?: boolean;
  closed?: boolean;
  draft?: boolean;
  active?: boolean;
  orphaned?: boolean;
  state?: string;
  type?: string;
  label?: string;
  author?: string;
  noBots?: boolean;
  since?: string;
  offline?: boolean;
  refresh?: boolean | "full";
  limit?: number;
  offset?: number;
  summary?: boolean;
  json?: boolean;
  debug?: boolean;
  noColor?: boolean;
}

const DEFAULT_STALE_THRESHOLD = "5m";

function applyGlobalOptions(options: ListCommandOptions): void {
  if (options.noColor) {
    process.env.NO_COLOR = "1";
  }
  if (options.debug) {
    process.env.FIREWATCH_DEBUG = "1";
  }
}

function isFullRepo(value: string): boolean {
  return /^[^/]+\/[^/]+$/.test(value);
}

function parseCsvList(value?: string): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parsePrs(value: string | boolean | undefined): number[] {
  if (!value || value === true) {
    return [];
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const parsed = Number.parseInt(part, 10);
      if (Number.isNaN(parsed)) {
        throw new TypeError(`Invalid PR number: ${part}`);
      }
      return parsed;
    });
}

function parseTypes(value?: string): FirewatchEntry["type"][] {
  const types = parseCsvList(value).map((type) => type.toLowerCase());
  if (types.length === 0) {
    return [];
  }
  const invalid = types.filter((t) => !ENTRY_TYPES.includes(t as never));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid type(s): ${invalid.join(", ")}. Valid types: ${ENTRY_TYPES.join(", ")}`
    );
  }
  return types as FirewatchEntry["type"][];
}

function parseAuthorFilters(value?: string): {
  include: string[];
  exclude: string[];
} {
  const items = parseCsvList(value);
  const include: string[] = [];
  const exclude: string[] = [];

  for (const item of items) {
    if (item.startsWith("!")) {
      const trimmed = item.slice(1).trim();
      if (trimmed) {
        exclude.push(trimmed);
      }
    } else {
      include.push(item);
    }
  }

  return { include, exclude };
}

function resolveBotPatterns(config: FirewatchConfig): RegExp[] | undefined {
  const patterns = config.filters?.bot_patterns ?? [];
  if (patterns.length === 0) {
    return undefined;
  }
  const compiled: RegExp[] = [];
  for (const pattern of patterns) {
    try {
      compiled.push(new RegExp(pattern, "i"));
    } catch {
      // Ignore invalid regex patterns
    }
  }
  return compiled.length > 0 ? compiled : undefined;
}

/**
 * Resolve the effective since filter.
 * Priority: explicit option > orphaned default (7d) > undefined
 */
function resolveSinceFilter(
  since: string | undefined,
  orphaned: boolean | undefined
): Date | undefined {
  const DEFAULT_ORPHANED_SINCE = "7d";
  if (since) {
    return parseSince(since);
  }
  if (orphaned) {
    return parseSince(DEFAULT_ORPHANED_SINCE);
  }
  return undefined;
}

function resolveAuthorFilters(
  options: ListCommandOptions,
  config: FirewatchConfig
): {
  includeAuthors: string[];
  excludeAuthors?: string[];
  excludeBots?: boolean;
  botPatterns?: RegExp[];
} {
  const { include, exclude } = parseAuthorFilters(options.author);
  const excludeBots = options.noBots || config.filters?.exclude_bots;
  const botPatterns = resolveBotPatterns(config);

  const configExclusions = config.filters?.exclude_authors ?? [];
  const mergedExclusions =
    excludeBots || exclude.length > 0 || configExclusions.length > 0
      ? mergeExcludeAuthors(
          [...configExclusions, ...exclude],
          excludeBots ?? false
        )
      : undefined;

  return {
    includeAuthors: include,
    ...(mergedExclusions && { excludeAuthors: mergedExclusions }),
    ...(excludeBots && { excludeBots }),
    ...(botPatterns && { botPatterns }),
  };
}

function listCachedRepos(): string[] {
  if (!existsSync(PATHS.repos)) {
    return [];
  }
  const files = readdirSync(PATHS.repos).filter((f) => f.endsWith(".jsonl"));
  return files
    .map((file) => parseRepoCacheFilename(file.replace(".jsonl", "")))
    .filter((repo): repo is string => repo !== null);
}

function resolveRepoFilter(
  options: ListCommandOptions,
  detectedRepo: string | null
): string | undefined {
  if (options.repo) {
    validateRepoFormat(options.repo);
    return options.repo;
  }
  if (options.all) {
    return undefined;
  }
  return detectedRepo ?? undefined;
}

function resolveReposToSync(
  options: ListCommandOptions,
  config: FirewatchConfig,
  detectedRepo: string | null
): string[] {
  if (options.repo && isFullRepo(options.repo)) {
    return [options.repo];
  }

  if (options.all) {
    if (config.repos.length > 0) {
      return config.repos;
    }
    const cached = listCachedRepos();
    if (cached.length > 0) {
      return cached;
    }
  }

  if (detectedRepo) {
    return [detectedRepo];
  }

  return [];
}

function getSyncMetaMap(): Map<string, { last_sync: string }> {
  const db = getDatabase();
  const allMeta = getAllSyncMeta(db);
  const map = new Map<string, { last_sync: string }>();
  for (const entry of allMeta) {
    map.set(entry.repo, { last_sync: entry.last_sync });
  }
  return map;
}

async function ensureRepoCache(
  repo: string,
  config: FirewatchConfig,
  detectedRepo: string | null,
  options: { full?: boolean } = {}
): Promise<{ synced: boolean }> {
  const auth = await detectAuth(config.github_token);
  if (!auth.token) {
    throw new Error(auth.error);
  }

  const client = new GitHubClient(auth.token);
  const useGraphite =
    detectedRepo === repo && (await getGraphiteStacks()) !== null;
  const plugins = useGraphite ? [graphitePlugin] : [];

  const spinner = ora({
    text: `Syncing ${repo}...`,
    stream: process.stderr,
    isEnabled: process.stderr.isTTY,
  }).start();

  try {
    const result = await syncRepo(client, repo, {
      ...(options.full && { full: true }),
      plugins,
    });
    spinner.succeed(`Synced ${repo} (${result.entriesAdded} entries)`);
  } catch (error) {
    spinner.fail(
      `Sync failed: ${error instanceof Error ? error.message : error}`
    );
    throw error;
  }

  return { synced: true };
}

function isStale(lastSync: string | undefined, threshold: string): boolean {
  if (!lastSync) {
    return true;
  }

  let thresholdMs = 0;
  try {
    thresholdMs = parseDurationMs(threshold);
  } catch {
    thresholdMs = parseDurationMs(DEFAULT_STALE_THRESHOLD);
  }

  const last = new Date(lastSync).getTime();
  return Date.now() - last > thresholdMs;
}

function hasRepoCache(repo: string): boolean {
  const db = getDatabase();
  const meta = getSyncMeta(db, repo);
  return meta !== null && countEntries(db, { exactRepo: repo }) > 0;
}

async function ensureFreshRepos(
  repos: string[],
  options: ListCommandOptions,
  config: FirewatchConfig,
  detectedRepo: string | null
): Promise<void> {
  if (repos.length === 0) {
    return;
  }

  if (options.offline) {
    for (const repo of repos) {
      if (!hasRepoCache(repo)) {
        throw new Error(`Offline mode: no cache for ${repo}.`);
      }
    }
    return;
  }

  const refresh = options.refresh;
  const forceRefresh = Boolean(refresh);
  const fullRefresh = refresh === "full";
  const autoSync = config.sync?.auto_sync ?? true;

  if (!autoSync && !forceRefresh) {
    return;
  }

  const meta = getSyncMetaMap();
  const threshold = config.sync?.stale_threshold ?? DEFAULT_STALE_THRESHOLD;

  for (const repo of repos) {
    if (!isFullRepo(repo)) {
      continue;
    }

    const hasCache = hasRepoCache(repo);
    const lastSync = meta.get(repo)?.last_sync;
    const needsSync = forceRefresh || !hasCache || isStale(lastSync, threshold);

    if (!needsSync) {
      continue;
    }

    await ensureRepoCache(repo, config, detectedRepo, {
      ...(fullRefresh && { full: true }),
    });
  }
}

export const listCommand = new Command("list")
  .description("List PRs and activity (default: current repo)")
  .option("--prs [numbers]", "Filter to PR domain, optionally specific PRs")
  .option("--repo <name>", "Filter to specific repository")
  .option("-a, --all", "Include all cached repos")
  .option("--mine", "Items on PRs assigned to me")
  .option("--reviews", "PRs I need to review")
  .option("--open", "Filter to open PRs")
  .option("--closed", "Include merged and closed PRs")
  .option("--draft", "Filter to draft PRs")
  .option("--active", "Alias for --open --draft")
  .option("--orphaned", "Unresolved review comments on merged/closed PRs")
  .option("--state <states>", "Explicit comma-separated PR states")
  .option(
    "--type <types>",
    "Filter by entry type (comment, review, commit, ci, event)"
  )
  .option("--label <name>", "Filter by PR label (partial match)")
  .option("--author <list>", "Filter by author(s), prefix with ! to exclude")
  .option("--no-bots", "Exclude bot activity")
  .option(
    "-s, --since <duration>",
    "Filter by time window. Formats: Nh, Nd, Nw, Nm (months). Examples: 24h, 7d"
  )
  .option("--offline", "Use cache only, no network")
  .option("--refresh [full]", "Force sync before query")
  .option("-n, --limit <count>", "Limit number of results", Number.parseInt)
  .option("--offset <count>", "Skip first N results", Number.parseInt)
  .option("--summary", "Aggregate entries into per-PR summary")
  .option("-j, --json", "Force JSON output")
  .option("--no-json", "Force human-readable output")
  .option("--debug", "Enable debug logging")
  .option("--no-color", "Disable color output")
  .action(async (options: ListCommandOptions) => {
    applyGlobalOptions(options);

    try {
      if (typeof options.refresh === "string" && options.refresh !== "full") {
        console.error(
          "Invalid --refresh value. Use --refresh or --refresh full."
        );
        process.exit(1);
      }

      if (options.offline && options.refresh) {
        console.error("--offline cannot be used with --refresh.");
        process.exit(1);
      }

      if (options.mine && options.reviews) {
        console.error("Cannot use both --mine and --reviews together.");
        process.exit(1);
      }

      if (options.orphaned && options.open) {
        console.error(
          "--orphaned cannot be used with --open (orphaned implies merged/closed PRs)."
        );
        process.exit(1);
      }

      let types: FirewatchEntry["type"][] = [];
      try {
        types = parseTypes(options.type);
      } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }

      let prs: number[] = [];
      try {
        prs = parsePrs(options.prs);
      } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }

      const config = await loadConfig();
      const outputJson = options.summary
        ? true
        : shouldOutputJson(options, config.output?.default_format);

      const detected = await detectRepo();
      const repoFilter = resolveRepoFilter(options, detected.repo ?? null);

      if (!repoFilter && !options.all) {
        console.error(
          "No repository detected. Use --repo owner/repo or run inside a git repo."
        );
        process.exit(1);
      }

      await ensureDirectories();

      const reposToSync = resolveReposToSync(
        options,
        config,
        detected.repo ?? null
      );
      await ensureFreshRepos(
        reposToSync,
        options,
        config,
        detected.repo ?? null
      );

      const states = resolveStates({
        ...(options.state && { state: options.state }),
        ...(options.open && { open: true }),
        ...(options.closed && { closed: true }),
        ...(options.draft && { draft: true }),
        ...(options.active && { active: true }),
        ...(options.orphaned && { orphaned: true }),
      });

      const authorFilters = resolveAuthorFilters(options, config);
      const includeAuthors = authorFilters.includeAuthors;

      // Resolve effective since: explicit option > orphaned default (7d) > undefined
      const effectiveSince = resolveSinceFilter(
        options.since,
        options.orphaned
      );

      const entries = await queryEntries({
        filters: {
          ...(repoFilter && { repo: repoFilter }),
          ...(prs.length > 0 && { prs }),
          ...(types.length > 0 && { type: types }),
          ...(states && { states }),
          ...(options.label && { label: options.label }),
          ...(effectiveSince && { since: effectiveSince }),
          ...(authorFilters.excludeAuthors && {
            excludeAuthors: authorFilters.excludeAuthors,
          }),
          ...(authorFilters.excludeBots && { excludeBots: true }),
          ...(authorFilters.botPatterns && {
            botPatterns: authorFilters.botPatterns,
          }),
          ...(options.orphaned && { orphaned: true }),
        },
        ...(options.limit !== undefined && { limit: options.limit }),
        ...(options.offset !== undefined && { offset: options.offset }),
      });

      let filtered = entries;

      if (includeAuthors.length > 0) {
        const includeSet = new Set(includeAuthors.map((a) => a.toLowerCase()));
        filtered = filtered.filter((entry) =>
          includeSet.has(entry.author.toLowerCase())
        );
      }

      if (options.mine || options.reviews) {
        const username = config.user?.github_username;
        if (!username) {
          console.error(
            "Set user.github_username in config for --mine/--reviews."
          );
          process.exit(1);
        }

        filtered = filtered.filter((entry) =>
          options.mine
            ? entry.pr_author === username
            : entry.pr_author !== username
        );
      }

      if (options.summary) {
        const wrote = await outputWorklist(filtered);
        if (!wrote && process.stderr.isTTY) {
          console.error("No entries found for summary.");
        }
        return;
      }

      if (outputJson) {
        if (filtered.length === 0 && process.stderr.isTTY) {
          console.error("No entries matched the query filters.");
        }
        for (const entry of filtered) {
          await writeJsonLine(entry);
        }
        return;
      }

      const repoLabel = repoFilter ?? (options.all ? "all" : "unknown");
      const username = config.user?.github_username;
      const actionableEntries = await ensureGraphiteMetadata(filtered);

      if (options.mine || options.reviews) {
        const perspective = options.mine ? "mine" : "reviews";
        const summary = buildActionableSummary(
          repoLabel,
          actionableEntries,
          perspective,
          username
        );
        printActionableSummary(summary);
        return;
      }

      if (username) {
        const mineSummary = buildActionableSummary(
          repoLabel,
          actionableEntries,
          "mine",
          username
        );
        printActionableSummary(mineSummary);

        const reviewSummary = buildActionableSummary(
          repoLabel,
          actionableEntries,
          "reviews",
          username
        );
        printActionableSummary(reviewSummary);
      } else {
        const summary = buildActionableSummary(repoLabel, actionableEntries);
        printActionableSummary(summary);
      }
    } catch (error) {
      console.error(
        "Query failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
