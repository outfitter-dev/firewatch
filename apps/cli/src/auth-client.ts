/**
 * Shared authentication and GitHub client creation helpers.
 *
 * Eliminates the repeated `detectAuth -> isErr check -> new GitHubClient`
 * pattern found across command files.
 */

import { GitHubClient, detectAuth } from "@outfitter/firewatch-core";

/**
 * Authenticated client with the token used to create it.
 */
export interface AuthenticatedClient {
  client: GitHubClient;
  token: string;
}

/**
 * Create an authenticated GitHub client, throwing on auth failure.
 *
 * Use in commands that require authentication (approve, comment, reply, etc.).
 * These commands are always wrapped in try-catch, so throwing is appropriate.
 *
 * @param githubToken - Optional token from config (`config.github_token`)
 * @returns Authenticated client and token
 * @throws {Error} When no authentication method is available
 */
export async function createAuthenticatedClient(
  githubToken: string | undefined
): Promise<AuthenticatedClient> {
  const auth = await detectAuth(githubToken);
  if (auth.isErr()) {
    throw new Error(auth.error.message);
  }

  return {
    client: new GitHubClient(auth.value.token),
    token: auth.value.token,
  };
}

/**
 * Try to create an authenticated GitHub client, returning null on failure.
 *
 * Use in commands where authentication is optional (view, list, ack).
 * The command can degrade gracefully when no auth is available.
 *
 * @param githubToken - Optional token from config (`config.github_token`)
 * @returns Authenticated client and token, or null if auth unavailable
 */
export async function tryCreateClient(
  githubToken: string | undefined
): Promise<AuthenticatedClient | null> {
  const auth = await detectAuth(githubToken);
  if (auth.isErr()) {
    return null;
  }

  return {
    client: new GitHubClient(auth.value.token),
    token: auth.value.token,
  };
}
