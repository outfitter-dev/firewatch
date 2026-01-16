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
      "graphite_enabled = true",
      "default_stack = false",
      'default_since = "7d"',
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
    ['default_stack = true', 'repos = ["outfitter-dev/other"]'].join("\n")
  );

  const resolvedProjectPath = await getProjectConfigPath(nested);
  expect(resolvedProjectPath).toBe(projectConfigPath);

  const config = await loadConfig({ cwd: nested });
  expect(config.default_stack).toBe(true);
  expect(config.repos).toEqual(["outfitter-dev/other"]);
  expect(config.graphite_enabled).toBe(true);
  expect(config.default_since).toBe("7d");
  expect(config.max_prs_per_sync).toBe(100);
});
