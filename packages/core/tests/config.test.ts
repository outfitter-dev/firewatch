import { afterAll, expect, test } from "bun:test";
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
