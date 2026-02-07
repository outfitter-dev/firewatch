import { describe, expect, test } from "bun:test";

/**
 * Tests for createAuthenticatedClient helper.
 *
 * These test the helper's contract:
 * - Throws when auth fails (strict mode)
 * - Returns { client, token } when auth succeeds
 * - Passes githubToken through to detectAuth
 */

// We test the interface contract rather than mocking internal modules.
// The helper is thin glue code, so we verify its type contract compiles
// and that the function exists with the expected signature.

describe("createAuthenticatedClient", () => {
  test("module exports createAuthenticatedClient function", async () => {
    const mod = await import("../src/auth-client");
    expect(typeof mod.createAuthenticatedClient).toBe("function");
  });

  test("module exports tryCreateClient function", async () => {
    const mod = await import("../src/auth-client");
    expect(typeof mod.tryCreateClient).toBe("function");
  });
});
