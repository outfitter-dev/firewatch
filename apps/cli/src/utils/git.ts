import { $ } from "bun";

export async function getCurrentBranch(): Promise<string | null> {
  try {
    const result = await $`git rev-parse --abbrev-ref HEAD`.quiet();
    return result.text().trim() || null;
  } catch {
    return null;
  }
}
