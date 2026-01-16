import { detectRepo } from "@outfitter/firewatch-core";
import { InvalidArgumentError } from "commander";

// Valid GitHub repo format: owner/name with exactly one slash
// Owner and name must be non-empty and not contain slashes
const REPO_FORMAT_REGEX = /^[^/]+\/[^/]+$/;

/**
 * Parse and validate a PR number argument.
 * Commander custom argument parser - throws InvalidArgumentError on failure.
 */
export function parsePrNumber(value: string): number {
  const num = Number.parseInt(value, 10);
  if (Number.isNaN(num) || num <= 0) {
    throw new InvalidArgumentError(
      `PR number must be a positive integer, got '${value}'`
    );
  }
  return num;
}

/**
 * Validate that a repo string matches the owner/repo format.
 * Throws if invalid.
 */
export function validateRepoFormat(repo: string): void {
  if (!REPO_FORMAT_REGEX.test(repo)) {
    throw new Error(
      `Invalid repo format: '${repo}'. Expected format: owner/repo`
    );
  }
}

export function parseRepoInput(repo: string): { owner: string; name: string } {
  validateRepoFormat(repo);
  const [owner, name] = repo.split("/");
  return { owner: owner!, name: name! };
}

export async function resolveRepoOrThrow(repo?: string): Promise<string> {
  if (repo) {
    validateRepoFormat(repo);
    return repo;
  }

  const detected = await detectRepo();
  if (detected.repo) {
    console.error(`Detected ${detected.repo} from ${detected.source}`);
    return detected.repo;
  }

  throw new Error("No repository detected. Use --repo owner/repo.");
}
