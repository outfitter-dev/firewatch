import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempRoot = await mkdtemp(join(tmpdir(), "firewatch-config-"));

const { PATHS } = await import("../src/cache");
const { getProjectConfigPath, loadConfig } = await import("../src/config");

const originalPaths = { ...PATHS };

afterAll(async () => {
  Object.assign(PATHS as Record<string, string>, originalPaths);
  await rm(tempRoot, { recursive: true, force: true });
});

test("loadConfig merges user and project config with project override", async () => {
  const userConfigPath = join(tempRoot, "user-config.toml");
  Object.assign(PATHS as Record<string, string>, {
    configFile: userConfigPath,
  });

  await writeFile(
    userConfigPath,
    [
      'repos = ["outfitter-dev/firewatch"]',
      "",
      "[user]",
      'github_username = "alice"',
      "",
      "[sync]",
      "auto_sync = false",
      "",
      "[filters]",
      "exclude_bots = true",
      'exclude_authors = ["dependabot"]',
    ].join("\n")
  );

  const repoRoot = join(tempRoot, "repo");
  await mkdir(repoRoot);
  await mkdir(join(repoRoot, ".git"));
  const nested = join(repoRoot, "nested");
  await mkdir(nested);

  const projectConfigPath = join(repoRoot, ".firewatch.toml");
  await writeFile(
    projectConfigPath,
    [
      'repos = ["outfitter-dev/other"]',
      "",
      "[sync]",
      'stale_threshold = "10m"',
      "",
      "[filters]",
      'exclude_authors = ["renovate"]',
      "",
      "[output]",
      'default_format = "json"',
    ].join("\n")
  );

  const resolvedProjectPath = await getProjectConfigPath(nested);
  expect(resolvedProjectPath).toBe(projectConfigPath);

  const config = await loadConfig({ cwd: nested });
  expect(config.sync?.auto_sync).toBe(false);
  expect(config.sync?.stale_threshold).toBe("10m");
  expect(config.filters?.exclude_bots).toBe(true);
  expect(config.filters?.exclude_authors).toEqual(["renovate"]);
  expect(config.output?.default_format).toBe("json");
  expect(config.user?.github_username).toBe("alice");
  expect(config.repos).toEqual(["outfitter-dev/other"]);
  expect(config.max_prs_per_sync).toBe(100);
});

// --------------------------------------------------------------------------
// Environment variable override tests
// --------------------------------------------------------------------------

const ENV_KEYS = [
  "FIREWATCH_GITHUB_TOKEN",
  "FIREWATCH_REPOS",
  "FIREWATCH_MAX_PRS_PER_SYNC",
  "FIREWATCH_SYNC_AUTO_SYNC",
  "FIREWATCH_SYNC_STALE_THRESHOLD",
  "FIREWATCH_OUTPUT_DEFAULT_FORMAT",
  "FIREWATCH_USER_GITHUB_USERNAME",
  "FIREWATCH_FILTERS_EXCLUDE_BOTS",
  "FIREWATCH_FILTERS_EXCLUDE_AUTHORS",
  "FIREWATCH_FILTERS_BOT_PATTERNS",
  "FIREWATCH_FEEDBACK_COMMIT_IMPLIES_READ",
] as const;

function clearEnvKey(key: string): void {
  // Using Reflect.deleteProperty avoids the no-dynamic-delete lint error
  Reflect.deleteProperty(process.env, key);
}

describe("environment variable overrides", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      clearEnvKey(key);
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const saved = savedEnv[key];
      if (saved === undefined) {
        clearEnvKey(key);
      } else {
        process.env[key] = saved;
      }
    }
  });

  test("env vars override file config for top-level options", async () => {
    const userConfigPath = join(tempRoot, "env-test-user.toml");
    Object.assign(PATHS as Record<string, string>, {
      configFile: userConfigPath,
    });
    await writeFile(
      userConfigPath,
      ['repos = ["outfitter-dev/firewatch"]', "max_prs_per_sync = 50"].join(
        "\n"
      )
    );

    // Set env vars
    process.env.FIREWATCH_REPOS = "org/repo1,org/repo2";
    process.env.FIREWATCH_MAX_PRS_PER_SYNC = "200";
    process.env.FIREWATCH_GITHUB_TOKEN = "ghp_test_token";

    const config = await loadConfig({ cwd: tempRoot });

    expect(config.repos).toEqual(["org/repo1", "org/repo2"]);
    expect(config.max_prs_per_sync).toBe(200);
    expect(config.github_token).toBe("ghp_test_token");
  });

  test("env vars override nested config sections", async () => {
    const userConfigPath = join(tempRoot, "env-nested-test.toml");
    Object.assign(PATHS as Record<string, string>, {
      configFile: userConfigPath,
    });
    await writeFile(
      userConfigPath,
      [
        "[sync]",
        "auto_sync = false",
        'stale_threshold = "5m"',
        "",
        "[filters]",
        "exclude_bots = false",
      ].join("\n")
    );

    // Env vars should override
    process.env.FIREWATCH_SYNC_AUTO_SYNC = "true";
    process.env.FIREWATCH_SYNC_STALE_THRESHOLD = "30m";
    process.env.FIREWATCH_FILTERS_EXCLUDE_BOTS = "1";
    process.env.FIREWATCH_USER_GITHUB_USERNAME = "testuser";
    process.env.FIREWATCH_OUTPUT_DEFAULT_FORMAT = "json";
    process.env.FIREWATCH_FEEDBACK_COMMIT_IMPLIES_READ = "true";

    const config = await loadConfig({ cwd: tempRoot });

    expect(config.sync?.auto_sync).toBe(true);
    expect(config.sync?.stale_threshold).toBe("30m");
    expect(config.filters?.exclude_bots).toBe(true);
    expect(config.user?.github_username).toBe("testuser");
    expect(config.output?.default_format).toBe("json");
    expect(config.feedback?.commit_implies_read).toBe(true);
  });

  test("env vars parse boolean values correctly", async () => {
    const userConfigPath = join(tempRoot, "env-bool-test.toml");
    Object.assign(PATHS as Record<string, string>, {
      configFile: userConfigPath,
    });
    await writeFile(userConfigPath, "");

    // Test "true" and "1" as truthy
    process.env.FIREWATCH_SYNC_AUTO_SYNC = "true";
    process.env.FIREWATCH_FILTERS_EXCLUDE_BOTS = "1";

    let config = await loadConfig({ cwd: tempRoot });

    expect(config.sync?.auto_sync).toBe(true);
    expect(config.filters?.exclude_bots).toBe(true);

    // Test "false" and "0" as falsy
    process.env.FIREWATCH_SYNC_AUTO_SYNC = "false";
    process.env.FIREWATCH_FILTERS_EXCLUDE_BOTS = "0";

    config = await loadConfig({ cwd: tempRoot });

    expect(config.sync?.auto_sync).toBe(false);
    expect(config.filters?.exclude_bots).toBe(false);
  });

  test("env vars parse comma-separated arrays", async () => {
    const userConfigPath = join(tempRoot, "env-array-test.toml");
    Object.assign(PATHS as Record<string, string>, {
      configFile: userConfigPath,
    });
    await writeFile(userConfigPath, "");

    process.env.FIREWATCH_REPOS = "org/repo1, org/repo2, org/repo3";
    process.env.FIREWATCH_FILTERS_EXCLUDE_AUTHORS = "dependabot,renovate";
    process.env.FIREWATCH_FILTERS_BOT_PATTERNS = String.raw`\[bot\],autofix`;

    const config = await loadConfig({ cwd: tempRoot });

    expect(config.repos).toEqual(["org/repo1", "org/repo2", "org/repo3"]);
    expect(config.filters?.exclude_authors).toEqual(["dependabot", "renovate"]);
    expect(config.filters?.bot_patterns).toEqual([
      String.raw`\[bot\]`,
      "autofix",
    ]);
  });

  test("env vars take precedence over project config", async () => {
    const userConfigPath = join(tempRoot, "env-precedence-user.toml");
    Object.assign(PATHS as Record<string, string>, {
      configFile: userConfigPath,
    });
    await writeFile(userConfigPath, 'repos = ["user/repo"]');

    const repoRoot = join(tempRoot, "env-precedence-repo");
    await mkdir(repoRoot);
    await mkdir(join(repoRoot, ".git"));
    await writeFile(
      join(repoRoot, ".firewatch.toml"),
      'repos = ["project/repo"]'
    );

    // Env should override both user and project config
    process.env.FIREWATCH_REPOS = "env/repo";

    const config = await loadConfig({ cwd: repoRoot });

    expect(config.repos).toEqual(["env/repo"]);
  });
});
