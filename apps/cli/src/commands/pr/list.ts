import {
  detectRepo,
  ensureDirectories,
  getAckedIds,
  loadConfig,
  queryEntries,
  type FirewatchEntry,
} from "@outfitter/firewatch-core";
import { Command } from "commander";

import {
  buildActionableSummary,
  printActionableSummary,
} from "../../actionable";
import {
  applyGlobalOptions,
  ensureFreshRepos,
  parsePrList,
  parseTypes,
  resolveAuthorFilters,
  resolveRepoFilter,
  resolveReposToSync,
  resolveSinceFilter,
  type QueryCommandOptions,
} from "../../query-helpers";
import { ensureGraphiteMetadata } from "../../stack";
import { outputStructured } from "../../utils/json";
import { resolveStates } from "../../utils/states";
import { shouldOutputJson } from "../../utils/tty";
import { outputWorklist } from "../../worklist";

export const listCommand = new Command("list")
  .description("List PRs and activity (default: current repo)")
  .option("--pr [numbers]", "Filter to PR domain, optionally specific PRs")
  .option("--repo <name>", "Filter to specific repository")
  .option("--all", "Include all cached repos")
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
  .option("--before <date>", "Entries created before ISO date (e.g., 2024-01-15)")
  .option("--offline", "Use cache only, no network")
  .option("--refresh [full]", "Force sync before query")
  .option("-n, --limit <count>", "Limit number of results", Number.parseInt)
  .option("--offset <count>", "Skip first N results", Number.parseInt)
  .option("--summary", "Aggregate entries into per-PR summary")
  .option("-j, --jsonl", "Force structured output")
  .option("--no-jsonl", "Force human-readable output")
  .option("--debug", "Enable debug logging")
  .option("--no-color", "Disable color output")
  .action(async (options: QueryCommandOptions) => {
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

      let prList: number[] = [];
      try {
        prList = parsePrList(options.pr);
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

      // Parse before date early so it can be passed to queryEntries
      let beforeDate: Date | undefined;
      if (options.before) {
        beforeDate = new Date(options.before);
        if (Number.isNaN(beforeDate.getTime())) {
          console.error(
            `Invalid --before date: ${options.before}. Use ISO format (e.g., 2024-01-15).`
          );
          process.exit(1);
        }
      }

      const entries = await queryEntries({
        filters: {
          ...(repoFilter && { repo: repoFilter }),
          ...(prList.length > 0 && {
            pr: prList.length === 1 ? prList[0] : prList,
          }),
          ...(types.length > 0 && { type: types }),
          ...(states && { states }),
          ...(options.label && { label: options.label }),
          ...(effectiveSince && { since: effectiveSince }),
          ...(beforeDate && { before: beforeDate }),
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

      if (prList.length > 0) {
        const prSet = new Set(prList);
        filtered = filtered.filter((entry) => prSet.has(entry.pr));
      }

      if (includeAuthors.length > 0) {
        const includeSet = new Set(includeAuthors.map((a) => a.toLowerCase()));
        filtered = filtered.filter((entry) =>
          includeSet.has(entry.author.toLowerCase())
        );
      }

      // Note: --before filter is now applied in queryEntries (before limit/offset)
      // to ensure correct pagination semantics

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
          await outputStructured(entry, "jsonl");
        }
        return;
      }

      const repoLabel = repoFilter ?? (options.all ? "all" : "unknown");
      const username = config.user?.github_username;
      const actionableEntries = await ensureGraphiteMetadata(filtered);
      const ackedIds = await getAckedIds(options.all ? undefined : repoFilter);

      if (options.mine || options.reviews) {
        const perspective = options.mine ? "mine" : "reviews";
        const summary = buildActionableSummary(
          repoLabel,
          actionableEntries,
          perspective,
          username,
          options.orphaned,
          { ackedIds }
        );
        printActionableSummary(summary);
        return;
      }

      if (username) {
        const mineSummary = buildActionableSummary(
          repoLabel,
          actionableEntries,
          "mine",
          username,
          options.orphaned,
          { ackedIds }
        );
        printActionableSummary(mineSummary);

        const reviewSummary = buildActionableSummary(
          repoLabel,
          actionableEntries,
          "reviews",
          username,
          options.orphaned,
          { ackedIds }
        );
        printActionableSummary(reviewSummary);
      } else {
        const summary = buildActionableSummary(
          repoLabel,
          actionableEntries,
          undefined,
          undefined,
          options.orphaned,
          { ackedIds }
        );
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
