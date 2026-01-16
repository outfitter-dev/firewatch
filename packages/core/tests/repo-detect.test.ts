import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectRepo } from "../src/repo-detect";

test("detectRepo reads repository from package.json string", async () => {
  const root = await mkdtemp(join(tmpdir(), "firewatch-repo-"));
  const child = join(root, "child");
  await mkdir(child);

  const packageJson = {
    name: "example",
    repository: "https://github.com/outfitter-dev/firewatch.git",
  };
  await writeFile(
    join(root, "package.json"),
    JSON.stringify(packageJson, null, 2)
  );

  try {
    const result = await detectRepo(child);
    expect(result.repo).toBe("outfitter-dev/firewatch");
    expect(result.source).toBe("package.json");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("detectRepo reads repository from package.json object", async () => {
  const root = await mkdtemp(join(tmpdir(), "firewatch-repo-"));
  const child = join(root, "child");
  await mkdir(child);

  const packageJson = {
    name: "example",
    repository: {
      type: "git",
      url: "git+https://github.com/outfitter-dev/firewatch.git",
    },
  };
  await writeFile(
    join(root, "package.json"),
    JSON.stringify(packageJson, null, 2)
  );

  try {
    const result = await detectRepo(child);
    expect(result.repo).toBe("outfitter-dev/firewatch");
    expect(result.source).toBe("package.json");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
