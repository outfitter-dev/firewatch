/**
 * Tests for syncHandler.
 *
 * The sync handler orchestrates repo resolution, auth, cache clearing, and
 * syncRepo() invocations. Tests here focus on the handler's contract:
 * - validates repo format before syncing
 * - handles clear flag (clears before auth)
 * - calls onProgress callback with start events
 * - uses config.repos and prefers explicit repos
 * - returns auth error when token is invalid
 */
import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { silentLogger } from "../../../shared/src/logger";
import { closeDatabase, openDatabase } from "../../src/db";
import { syncHandler } from "../../src/handlers/sync";
import type { HandlerContext } from "../../src/handlers/types";
import {
  countEntries,
  insertEntries,
  upsertPR,
  type PRMetadata,
} from "../../src/repository";
import type { FirewatchEntry } from "../../src/schema/entry";

// =============================================================================
// Test Fixtures
// =============================================================================

function createTestPR(overrides: Partial<PRMetadata> = {}): PRMetadata {
  return {
    repo: "owner/repo",
    number: 1,
    state: "open",
    isDraft: false,
    title: "Test PR",
    author: "testuser",
    branch: "feature/test",
    labels: [],
    ...overrides,
  };
}

function createTestEntry(
  overrides: Partial<FirewatchEntry> = {}
): FirewatchEntry {
  return {
    id: "entry-1",
    repo: "owner/repo",
    pr: 1,
    pr_title: "Test PR",
    pr_state: "open",
    pr_author: "testuser",
    pr_branch: "feature/test",
    type: "comment",
    subtype: "issue_comment",
    author: "commenter",
    body: "LGTM",
    created_at: "2025-01-15T12:00:00Z",
    captured_at: "2025-01-15T12:00:00Z",
    url: "https://github.com/owner/repo/pull/1#issuecomment-123",
    ...overrides,
  };
}

/** Context with a guaranteed invalid token to prevent real auth. */
function createInvalidAuthContext(db: Database): HandlerContext {
  return {
    config: {
      repos: [],
      max_prs_per_sync: 100,
      github_token: "__invalid_token_for_testing__",
    },
    db,
    logger: silentLogger,
  };
}

// =============================================================================
// syncHandler — validation
// =============================================================================

describe("syncHandler validation", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    closeDatabase(db);
  });

  test("returns error for empty string repo", async () => {
    const ctx = createInvalidAuthContext(db);

    const result = await syncHandler({ repos: [""] }, ctx);

    expect(result.isErr()).toBe(true);
    expect(result.error?.message).toMatch(/invalid repo/i);
  });

  test("returns error for repo without slash", async () => {
    const ctx = createInvalidAuthContext(db);

    const result = await syncHandler({ repos: ["noslash"] }, ctx);

    expect(result.isErr()).toBe(true);
    expect(result.error?.message).toMatch(/invalid repo/i);
  });
});

// =============================================================================
// syncHandler — auth behaviour
// =============================================================================

describe("syncHandler auth", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    closeDatabase(db);
  });

  test("returns error when auth token is invalid", async () => {
    const ctx = createInvalidAuthContext(db);

    const result = await syncHandler({ repos: ["owner/repo"] }, ctx);

    expect(result.isErr()).toBe(true);
  });

  test("error message does not mention sync-meta on auth failure", async () => {
    const ctx = createInvalidAuthContext(db);

    const result = await syncHandler({ repos: ["owner/repo"] }, ctx);

    expect(result.error?.message.toLowerCase()).not.toMatch(/sync meta/);
  });
});

// =============================================================================
// syncHandler — clear flag
// =============================================================================

describe("syncHandler clear flag", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    closeDatabase(db);
  });

  test("clears cached entries before syncing even when auth fails", async () => {
    upsertPR(db, createTestPR({ repo: "owner/repo", number: 1 }));
    insertEntries(db, [
      createTestEntry({ id: "e1", repo: "owner/repo", pr: 1 }),
    ]);

    const beforeCount = countEntries(db);
    expect(beforeCount).toBe(1);

    const ctx = createInvalidAuthContext(db);
    await syncHandler({ repos: ["owner/repo"], clear: true }, ctx);

    const afterCount = countEntries(db);
    expect(afterCount).toBe(0);
  });

  test("preserves entries when clear flag is not set", async () => {
    upsertPR(db, createTestPR({ repo: "owner/repo", number: 1 }));
    insertEntries(db, [
      createTestEntry({ id: "e1", repo: "owner/repo", pr: 1 }),
    ]);

    const ctx = createInvalidAuthContext(db);
    await syncHandler({ repos: ["owner/repo"] }, ctx);

    const afterCount = countEntries(db);
    expect(afterCount).toBe(1);
  });
});

// =============================================================================
// syncHandler — progress callback
// =============================================================================

describe("syncHandler progress callback", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    closeDatabase(db);
  });

  test("fires start event for each requested repo", async () => {
    const ctx = createInvalidAuthContext(db);
    const allEvents: { repo: string; status: string }[] = [];

    await syncHandler(
      {
        repos: ["owner/repo"],
        onProgress: (repo, status) => {
          allEvents.push({ repo, status });
        },
      },
      ctx
    );

    const startedRepos = allEvents
      .filter((e) => e.status === "start")
      .map((e) => e.repo);
    expect(startedRepos).toContain("owner/repo");
  });

  test("records all progress events for multiple repos", async () => {
    const ctx: HandlerContext = {
      config: {
        repos: [],
        max_prs_per_sync: 100,
        github_token: "__invalid_token_for_testing__",
      },
      db,
      logger: silentLogger,
    };
    const allEvents: { repo: string; status: string }[] = [];

    await syncHandler(
      {
        repos: ["owner/repo-a", "owner/repo-b"],
        onProgress: (repo, status) => {
          allEvents.push({ repo, status });
        },
      },
      ctx
    );

    const startedRepos = allEvents
      .filter((e) => e.status === "start")
      .map((e) => e.repo);
    expect(startedRepos).toContain("owner/repo-a");
    expect(startedRepos).toContain("owner/repo-b");
  });
});

// =============================================================================
// syncHandler — repo resolution
// =============================================================================

describe("syncHandler repo resolution", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    closeDatabase(db);
  });

  test("uses config.repos when no explicit repos provided", async () => {
    const allEvents: { repo: string; status: string }[] = [];
    const ctx: HandlerContext = {
      config: {
        repos: ["owner/configured-repo"],
        max_prs_per_sync: 100,
        github_token: "__invalid_token_for_testing__",
      },
      db,
      logger: silentLogger,
    };

    await syncHandler(
      {
        onProgress: (repo, status) => {
          allEvents.push({ repo, status });
        },
      },
      ctx
    );

    const startedRepos = allEvents
      .filter((e) => e.status === "start")
      .map((e) => e.repo);
    expect(startedRepos).toContain("owner/configured-repo");
  });

  test("prefers explicit repos over config.repos", async () => {
    const allEvents: { repo: string; status: string }[] = [];
    const ctx: HandlerContext = {
      config: {
        repos: ["owner/configured-repo"],
        max_prs_per_sync: 100,
        github_token: "__invalid_token_for_testing__",
      },
      db,
      logger: silentLogger,
    };

    await syncHandler(
      {
        repos: ["owner/explicit-repo"],
        onProgress: (repo, status) => {
          allEvents.push({ repo, status });
        },
      },
      ctx
    );

    const startedRepos = allEvents
      .filter((e) => e.status === "start")
      .map((e) => e.repo);
    expect(startedRepos).toContain("owner/explicit-repo");
    expect(startedRepos).not.toContain("owner/configured-repo");
  });
});
