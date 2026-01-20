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
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";

import { outputStructured } from "../utils/json";
import { MARKERS, renderHeader } from "../utils/tree";
import { shouldOutputJson } from "../utils/tty";

interface DoctorCommandOptions {
  jsonl?: boolean;
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

async function checkGraphiteCli(): Promise<CheckResult> {
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

export const doctorCommand = new Command("doctor")
  .description("Diagnose Firewatch setup")
  .option("--jsonl", "Force structured output")
  .option("--no-jsonl", "Force human-readable output")
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
        await checkGraphiteCli(),
      ];

      const graphiteInfo = await getGraphiteStackInfo();

      const okCount = checks.filter((check) => check.ok).length;
      const failCount = checks.length - okCount;

      if (shouldOutputJson(options, config.output?.default_format)) {
        await outputStructured(
          {
            ok: failCount === 0,
            checks,
            graphite: graphiteInfo,
            counts: { ok: okCount, failed: failCount },
          },
          "jsonl"
        );
        return;
      }

      // Render header
      const headerLines = renderHeader(["Firewatch Health Check"], 24);
      for (const line of headerLines) {
        console.log(line);
      }
      console.log("");

      // Render checks as simple left-aligned list
      for (const check of checks) {
        const marker = check.ok ? MARKERS.pass : MARKERS.fail;
        const detail = check.message ? `: ${check.message}` : "";
        console.log(`${marker} ${check.name}${detail}`);
        if (!check.ok && check.hint) {
          console.log(`  ${check.hint}`);
        }
      }

      // Show Graphite stack info if CLI is available
      const graphiteCheck = checks.find((c) => c.name === "Graphite CLI");
      if (graphiteCheck?.ok && graphiteInfo.stackCount > 0) {
        console.log(`  ${graphiteInfo.stackCount} active stack(s)`);
      }

      // Summary
      console.log("");
      console.log(`${okCount} passed, ${failCount} failed`);
    } catch (error) {
      console.error(
        "Doctor failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
