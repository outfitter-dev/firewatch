import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";

import {
  GitHubClient,
  PATHS,
  detectAuth,
  detectRepo,
  ensureDirectories,
  getConfigPaths,
  getProjectConfigPath,
  loadConfig,
} from "@outfitter/firewatch-core";
import { getGraphiteStacks } from "@outfitter/firewatch-core/plugins";
import { Command } from "commander";

import { writeJsonLine } from "../utils/json";
import { shouldOutputJson } from "../utils/tty";

interface DoctorCommandOptions {
  json?: boolean;
  noJson?: boolean;
  fix?: boolean;
}

interface CheckResult {
  name: string;
  ok: boolean;
  message?: string;
  hint?: string;
}

async function checkGithubReachable(): Promise<CheckResult> {
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

async function checkAuth(): Promise<CheckResult> {
  const config = await loadConfig();
  const auth = await detectAuth(config.github_token);
  if (!auth.token) {
    return {
      name: "Auth valid",
      ok: false,
      message: auth.error ?? "No auth token found",
      hint: "Run `gh auth login` or set FIREWATCH_GITHUB_TOKEN.",
    };
  }

  try {
    const client = new GitHubClient(auth.token);
    const login = await client.fetchViewerLogin();
    return {
      name: "Auth valid",
      ok: true,
      message: `${login} via ${auth.source}`,
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

async function checkConfigParse(): Promise<CheckResult> {
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

async function checkCacheWritable(): Promise<CheckResult> {
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

async function checkRepoDetection(): Promise<CheckResult> {
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

async function checkGraphite(): Promise<CheckResult> {
  try {
    const stacks = await getGraphiteStacks();
    if (!stacks) {
      return {
        name: "Graphite CLI available",
        ok: false,
        message: "gt not available or no stacks found",
      };
    }
    return {
      name: "Graphite CLI available",
      ok: true,
      message: `${stacks.length} stack(s) detected`,
    };
  } catch (error) {
    return {
      name: "Graphite CLI available",
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export const doctorCommand = new Command("doctor")
  .description("Diagnose Firewatch setup")
  .option("--json", "Force JSON output")
  .option("--no-json", "Force human-readable output")
  .option("--fix", "Attempt to fix issues automatically")
  .action(async (options: DoctorCommandOptions) => {
    try {
      const config = await loadConfig();
      if (options.fix) {
        await ensureDirectories();
      }

      const checks: CheckResult[] = [
        await checkGithubReachable(),
        await checkAuth(),
        await checkConfigParse(),
        await checkCacheWritable(),
        await checkRepoDetection(),
        await checkGraphite(),
      ];

      const okCount = checks.filter((check) => check.ok).length;
      const failCount = checks.length - okCount;

      if (shouldOutputJson(options, config.output?.default_format)) {
        await writeJsonLine({
          ok: failCount === 0,
          checks,
          counts: { ok: okCount, failed: failCount },
        });
        return;
      }

      console.log("Checking firewatch health...\n");
      for (const check of checks) {
        const status = check.ok ? "OK " : "FAIL";
        const detail = check.message ? `: ${check.message}` : "";
        console.log(`${status} ${check.name}${detail}`);
        if (!check.ok && check.hint) {
          console.log(`  -> ${check.hint}`);
        }
      }

      if (failCount === 0) {
        console.log("\nAll systems operational");
      } else {
        console.log(`\n${failCount} issue${failCount === 1 ? "" : "s"} found`);
      }
    } catch (error) {
      console.error(
        "Doctor failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
