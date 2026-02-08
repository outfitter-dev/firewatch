import {
  GitHubClient,
  detectAuth,
  detectRepo,
  loadConfig,
  type FirewatchConfig,
} from "@outfitter/firewatch-core";

import type { FeedbackParams } from "../schemas";
import { ensureRepoCacheIfNeeded } from "./repo";

export interface FeedbackContext {
  repo: string;
  owner: string;
  name: string;
  config: FirewatchConfig;
  client: GitHubClient;
  detectedRepo: string | null;
}

export async function createFeedbackContext(
  params: FeedbackParams
): Promise<FeedbackContext> {
  const config = await loadConfig();
  const detected = await detectRepo();
  const repo = params.repo ?? detected.repo;

  if (!repo) {
    throw new Error("No repository detected. Provide repo.");
  }

  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid repo format: ${repo}. Expected owner/repo.`);
  }

  const auth = await detectAuth(config.github_token);
  if (auth.isErr()) {
    throw new Error(auth.error.message);
  }

  const client = new GitHubClient(auth.value.token);
  await ensureRepoCacheIfNeeded(repo, config, detected.repo, ["open", "draft"]);

  return { repo, owner, name, config, client, detectedRepo: detected.repo };
}
