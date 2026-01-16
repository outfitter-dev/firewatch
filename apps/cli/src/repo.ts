import { detectRepo } from "@outfitter/firewatch-core";

export function parseRepoInput(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid repo format: ${repo}. Expected owner/repo`);
  }
  return { owner, name };
}

export async function resolveRepoOrThrow(repo?: string): Promise<string> {
  if (repo) {
    return repo;
  }

  const detected = await detectRepo();
  if (detected.repo) {
    console.error(`Detected ${detected.repo} from ${detected.source}`);
    return detected.repo;
  }

  throw new Error("No repository detected. Use --repo owner/repo.");
}
