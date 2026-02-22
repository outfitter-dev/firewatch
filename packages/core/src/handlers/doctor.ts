import { Result } from "@outfitter/contracts";

import { detectAuth } from "../auth";
import { ensureDirectories, PATHS } from "../cache";
import { getConfigPaths, getProjectConfigPath, loadConfig } from "../config";
import { getGraphiteStacks } from "../plugins";
import { detectRepo } from "../repo-detect";
import type { HandlerContext } from "./types";

// =============================================================================
// Types
// =============================================================================

/** Input parameters for the doctor handler. */
export interface DoctorInput {
  /** Attempt to fix issues automatically (e.g. create missing directories). */
  fix?: boolean | undefined;
}

/** Result of a single diagnostic check. */
export interface DoctorCheckResult {
  /** Human-readable name of the check. */
  name: string;
  /** Whether the check passed. */
  ok: boolean;
  /** Descriptive message (details on success, error on failure). */
  message?: string | undefined;
  /** Actionable hint for resolving a failure. */
  hint?: string | undefined;
}

/** Structured output from the doctor handler. */
export interface DoctorOutput {
  /** Results from each diagnostic check. */
  checks: DoctorCheckResult[];
  /** Graphite stack provider availability. */
  graphite: { available: boolean; stacks?: number | undefined };
  /** Summary counts of passed and failed checks. */
  counts: { ok: number; failed: number };
}

// =============================================================================
// Individual Checks
// =============================================================================

async function checkGithubReachable(): Promise<DoctorCheckResult> {
  try {
    const response = await fetch("https://api.github.com", {
      method: "GET",
      headers: { "User-Agent": "firewatch-cli" },
    });
    if (!response.ok) {
      return {
        name: "GitHub API reachable",
        ok: false,
        message: `${response.status} ${response.statusText}`,
      };
    }
    return { name: "GitHub API reachable", ok: true };
  } catch (error) {
    return {
      name: "GitHub API reachable",
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkAuth(ctx: HandlerContext): Promise<DoctorCheckResult> {
  const auth = await detectAuth(ctx.config.github_token);
  if (auth.isErr()) {
    return {
      name: "Auth valid",
      ok: false,
      message: auth.error.message,
      hint: "Run `gh auth login` or set FIREWATCH_GITHUB_TOKEN.",
    };
  }

  try {
    const { GitHubClient } = await import("../github");
    const client = new GitHubClient(auth.value.token);
    const loginResult = await client.fetchViewerLogin();
    const login = loginResult.isOk() ? loginResult.value : "unknown";
    return {
      name: "Auth valid",
      ok: true,
      message: `${login} via ${auth.value.source}`,
    };
  } catch (error) {
    return {
      name: "Auth valid",
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      hint: "Run `gh auth login` to re-authenticate.",
    };
  }
}

async function checkConfigParse(): Promise<DoctorCheckResult> {
  try {
    await loadConfig({ strict: true });
    const paths = await getConfigPaths();
    const projectPath = await getProjectConfigPath();
    const userExists = await Bun.file(paths.user).exists();
    const projectExists = projectPath
      ? await Bun.file(projectPath).exists()
      : false;
    let location = "no config files";
    if (userExists) {
      location = paths.user;
    }
    if (projectExists && projectPath) {
      location = `${projectPath} + ${paths.user}`;
    }
    return { name: "Config parse", ok: true, message: location };
  } catch (error) {
    return {
      name: "Config parse",
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkCacheWritable(): Promise<DoctorCheckResult> {
  const { constants: fsConstants } = await import("node:fs");
  const { access } = await import("node:fs/promises");
  try {
    await ensureDirectories();
    await access(PATHS.cache, fsConstants.W_OK);
    await access(PATHS.repos, fsConstants.W_OK);
    return { name: "Cache writable", ok: true };
  } catch (error) {
    return {
      name: "Cache writable",
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkRepoDetection(): Promise<DoctorCheckResult> {
  const detected = await detectRepo();
  if (!detected.repo) {
    return {
      name: "Repository detected",
      ok: false,
      message: "No repo detected",
    };
  }
  return {
    name: "Repository detected",
    ok: true,
    message: `${detected.repo} (${detected.source})`,
  };
}

async function checkGraphiteCli(): Promise<DoctorCheckResult> {
  try {
    const result = await Bun.$`gt --version`.nothrow().quiet();
    if (result.exitCode !== 0) {
      return {
        name: "Graphite CLI",
        ok: false,
        message: "gt not found",
        hint: "Install from https://graphite.dev/docs/installing-the-cli",
      };
    }
    const version = result.text().trim();
    return {
      name: "Graphite CLI",
      ok: true,
      message: version,
    };
  } catch {
    return {
      name: "Graphite CLI",
      ok: false,
      message: "gt not found",
      hint: "Install from https://graphite.dev/docs/installing-the-cli",
    };
  }
}

async function getGraphiteStackInfo(): Promise<{
  available: boolean;
  stackCount: number;
}> {
  try {
    const stacks = await getGraphiteStacks();
    return {
      available: stacks !== null,
      stackCount: stacks?.length ?? 0,
    };
  } catch {
    return { available: false, stackCount: 0 };
  }
}

// =============================================================================
// Handler
// =============================================================================

/**
 * Run Firewatch diagnostic checks.
 *
 * Checks authentication, config parsing, cache writability, repository
 * detection, Graphite CLI availability, and GitHub API reachability.
 * Returns structured results that each transport can format independently.
 *
 * @param input - Doctor input options
 * @param ctx - Handler context with config, db, and logger
 * @returns Result containing DoctorOutput on success
 */
export async function doctorHandler(
  input: DoctorInput,
  ctx: HandlerContext
): Promise<Result<DoctorOutput, Error>> {
  if (input.fix) {
    await ensureDirectories();
  }

  const checks: DoctorCheckResult[] = [
    await checkGithubReachable(),
    await checkAuth(ctx),
    await checkConfigParse(),
    await checkCacheWritable(),
    await checkRepoDetection(),
    await checkGraphiteCli(),
  ];

  const graphiteInfo = await getGraphiteStackInfo();

  const okCount = checks.filter((check) => check.ok).length;
  const failCount = checks.length - okCount;

  return Result.ok({
    checks,
    graphite: {
      available: graphiteInfo.available,
      ...(graphiteInfo.stackCount > 0 && { stacks: graphiteInfo.stackCount }),
    },
    counts: { ok: okCount, failed: failCount },
  });
}
