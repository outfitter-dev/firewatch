import { $ } from "bun";

/**
 * Authentication source for GitHub API access.
 */
export type AuthSource = "gh-cli" | "env" | "config" | "none";

/**
 * Result of authentication detection.
 */
export interface AuthResult {
  token: string | null;
  source: AuthSource;
  error?: string;
}

/**
 * Check if the gh CLI is authenticated.
 */
async function checkGhAuth(): Promise<boolean> {
  const result = await $`gh auth status`.nothrow().quiet();
  return result.exitCode === 0;
}

/**
 * Get token from gh CLI.
 */
async function getGhToken(): Promise<string | null> {
  const result = await $`gh auth token`.nothrow().quiet();
  if (result.exitCode !== 0) {
    return null;
  }
  return result.text().trim() || null;
}

/**
 * Get token from environment variables.
 * Checks FIREWATCH_GITHUB_TOKEN first, then GITHUB_TOKEN.
 */
function getEnvToken(): string | null {
  return process.env.FIREWATCH_GITHUB_TOKEN || process.env.GITHUB_TOKEN || null;
}

/**
 * Detect and return GitHub authentication using adaptive strategy.
 *
 * Order of precedence:
 * 1. gh CLI (if authenticated)
 * 2. Environment variable (FIREWATCH_GITHUB_TOKEN or GITHUB_TOKEN)
 * 3. Config file token (passed as parameter)
 * 4. Error (no authentication found)
 *
 * @param configToken - Optional token from config file
 */
export async function detectAuth(configToken?: string): Promise<AuthResult> {
  // Try gh CLI first
  if (await checkGhAuth()) {
    const token = await getGhToken();
    if (token) {
      return { token, source: "gh-cli" };
    }
  }

  // Try environment variables
  const envToken = getEnvToken();
  if (envToken) {
    return { token: envToken, source: "env" };
  }

  // Try config file token
  if (configToken) {
    return { token: configToken, source: "config" };
  }

  // No authentication found
  return {
    token: null,
    source: "none",
    error:
      "No GitHub authentication found. Please authenticate with `gh auth login`, " +
      "set GITHUB_TOKEN environment variable, or configure a token with `fw config github_token <token>`.",
  };
}
