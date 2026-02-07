import {
  GitHubClient,
  detectAuth,
  loadConfig,
} from "@outfitter/firewatch-core";

import { resolveRepo } from "./repo";

export interface MutationContext {
  repo: string;
  owner: string;
  name: string;
  client: GitHubClient;
}

export async function createMutationContext(
  repoParam: string | undefined
): Promise<MutationContext> {
  const repo = (await resolveRepo(repoParam)) ?? null;
  if (!repo) {
    throw new Error("No repository detected. Provide repo.");
  }

  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid repo format: ${repo}. Expected owner/repo.`);
  }

  const config = await loadConfig();
  const auth = await detectAuth(config.github_token);
  if (auth.isErr()) {
    throw new Error(auth.error.message);
  }

  return { repo, owner, name, client: new GitHubClient(auth.value.token) };
}
