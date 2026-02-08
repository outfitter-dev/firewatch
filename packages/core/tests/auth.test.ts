import { AuthError } from "@outfitter/contracts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { detectAuth, type AuthInfo } from "../src/auth";

/**
 * Environment variable keys that affect auth detection.
 * Saved/restored around each test to avoid leaking state.
 */
const AUTH_ENV_KEYS = [
  "FIREWATCH_GITHUB_TOKEN",
  "GITHUB_TOKEN",
  "GH_CONFIG_DIR",
] as const;

function clearEnvKey(key: string): void {
  Reflect.deleteProperty(process.env, key);
}

/**
 * Point gh CLI at a nonexistent config directory so `gh auth status` fails.
 * This prevents the gh CLI auth path from succeeding in tests without
 * modifying PATH (which Bun's shell caches at startup).
 */
function disableGhCli(): void {
  process.env.GH_CONFIG_DIR = "/tmp/firewatch-test-no-gh-auth";
}

/**
 * Run assertions for gh CLI auth. Always asserts at least once:
 * - When gh is authenticated: verifies token and source
 * - When gh is unavailable (e.g. CI): verifies error is AuthError
 */
async function verifyGhCliAuth(savedGhConfig: string | undefined): Promise<void> {
  if (savedGhConfig) {
    process.env.GH_CONFIG_DIR = savedGhConfig;
  }

  const result = await detectAuth();

  if (result.isErr()) {
    // gh CLI not available — verify we get a proper AuthError
    expect(result.error).toBeInstanceOf(AuthError);
    return;
  }

  const auth = result.value;
  expect(auth.source).toBe("gh-cli");
  expect(auth.token).toBeTruthy();
}

describe("detectAuth", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of AUTH_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      clearEnvKey(key);
    }
  });

  afterEach(() => {
    for (const key of AUTH_ENV_KEYS) {
      const saved = savedEnv[key];
      if (saved === undefined) {
        clearEnvKey(key);
      } else {
        process.env[key] = saved;
      }
    }
  });

  describe("with gh CLI unavailable", () => {
    beforeEach(() => {
      disableGhCli();
    });

    test("returns env source when GITHUB_TOKEN is set", async () => {
      process.env.GITHUB_TOKEN = "ghp_test_github_token";

      const result = await detectAuth();

      expect(result.isOk()).toBe(true);
      const auth = result.value as AuthInfo;
      expect(auth.token).toBe("ghp_test_github_token");
      expect(auth.source).toBe("env");
    });

    test("returns env source when FIREWATCH_GITHUB_TOKEN is set", async () => {
      process.env.FIREWATCH_GITHUB_TOKEN = "ghp_firewatch_token";

      const result = await detectAuth();

      expect(result.isOk()).toBe(true);
      const auth = result.value as AuthInfo;
      expect(auth.token).toBe("ghp_firewatch_token");
      expect(auth.source).toBe("env");
    });

    test("prefers FIREWATCH_GITHUB_TOKEN over GITHUB_TOKEN", async () => {
      process.env.FIREWATCH_GITHUB_TOKEN = "ghp_firewatch_preferred";
      process.env.GITHUB_TOKEN = "ghp_github_fallback";

      const result = await detectAuth();

      expect(result.isOk()).toBe(true);
      const auth = result.value as AuthInfo;
      expect(auth.token).toBe("ghp_firewatch_preferred");
      expect(auth.source).toBe("env");
    });

    test("returns config source when configToken is provided and no env token", async () => {
      const result = await detectAuth("ghp_config_token");

      expect(result.isOk()).toBe(true);
      const auth = result.value as AuthInfo;
      expect(auth.token).toBe("ghp_config_token");
      expect(auth.source).toBe("config");
    });

    test("prefers env token over config token", async () => {
      process.env.GITHUB_TOKEN = "ghp_env_wins";

      const result = await detectAuth("ghp_config_loses");

      expect(result.isOk()).toBe(true);
      const auth = result.value as AuthInfo;
      expect(auth.token).toBe("ghp_env_wins");
      expect(auth.source).toBe("env");
    });

    test("returns AuthError result when no authentication is available", async () => {
      const result = await detectAuth();

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(AuthError);
    });

    test("error message includes remediation guidance", async () => {
      const result = await detectAuth();

      expect(result.isErr()).toBe(true);
      const error = result.error as InstanceType<typeof AuthError>;
      expect(error.message).toContain("gh auth login");
      expect(error.message).toContain("GITHUB_TOKEN");
    });

    test("error message mentions config command", async () => {
      const result = await detectAuth();

      expect(result.isErr()).toBe(true);
      const error = result.error as InstanceType<typeof AuthError>;
      expect(error.message).toContain("fw config");
    });
  });

  describe("with gh CLI available", () => {
    test("returns gh-cli source when gh is authenticated", async () => {
      await verifyGhCliAuth(savedEnv.GH_CONFIG_DIR);
    });
  });
});
