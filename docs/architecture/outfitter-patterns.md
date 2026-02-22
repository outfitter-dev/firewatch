# Outfitter Stack Patterns Guide for Firewatch

Reference for bringing Firewatch in line with the full Outfitter stack. Covers what packages are available, what Firewatch already uses, what patterns apply, and the concrete steps to adopt them.

## Package Landscape

All packages published to npm under `@outfitter/*`. Versions as of 2026-02-21.

### Currently Used

| Package                | Firewatch Version | Latest | Used In          |
| ---------------------- | ----------------- | ------ | ---------------- |
| `@outfitter/contracts` | ^0.4.1            | 0.4.1  | core, shared     |
| `@outfitter/cli`       | ^0.5.2            | 0.5.2  | cli              |
| `@outfitter/mcp`       | ^0.4.2            | 0.4.2  | mcp              |
| `@outfitter/logging`   | ^0.4.1            | 0.4.1  | mcp (transitive) |
| `@outfitter/config`    | ^0.3.3            | 0.3.3  | cli (transitive) |
| `@outfitter/schema`    | ^0.2.2            | 0.2.2  | cli (transitive) |
| `@outfitter/types`     | ^0.2.3            | 0.2.3  | cli (transitive) |

### Available for Adoption

| Package               | Latest | What It Provides                                                   | Priority |
| --------------------- | ------ | ------------------------------------------------------------------ | -------- |
| `@outfitter/logging`  | 0.4.1  | Structured logging, redaction, sinks, child loggers (direct usage) | Medium   |
| `@outfitter/config`   | 0.3.3  | XDG-compliant paths, config loading (direct usage)                 | Medium   |
| `@outfitter/tui`      | 0.2.1  | Rendering (tables, trees, boxes), spinners, prompts                | Medium   |
| `@outfitter/testing`  | 0.2.4  | Test harnesses, fixtures, `withTempDir`, `withEnv`                 | Medium   |
| `@outfitter/tooling`  | 0.3.0  | Biome/TypeScript/Lefthook presets (dev dep)                        | Low      |
| `@outfitter/state`    | 0.2.3  | Pagination cursors, state management                               | Low      |
| `@outfitter/index`    | 0.2.3  | SQLite FTS5, WAL mode, BM25 ranking                               | Low      |
| `@outfitter/file-ops` | 0.2.3  | Atomic writes, file locking, secure paths                          | Low      |
| `@outfitter/daemon`   | 0.2.4  | Background service lifecycle, IPC, health checks                   | Low      |

---

## Pattern 1: Handler Contract (Transport-Agnostic Logic)

The central pattern in the Outfitter stack. Handlers are pure functions that accept typed input and context, returning `Result<TOutput, TError>`. CLI and MCP are thin adapters.

### Current State in Firewatch

Firewatch has a **complete** handler layer in `packages/core/src/handlers/`. All 12 operations (approve, reject, comment, reply, close, ack, edit, query, sync, status, doctor) are implemented as transport-agnostic handlers returning `Result<T, E>`. The CLI commands call handlers via thin adapters using `exitWithError()` from `@outfitter/cli`. The MCP tools use `defineTool()` from `@outfitter/mcp` and call the same handlers.

### Target Pattern

```typescript
// packages/core/src/handlers/approve.ts
import { Result, type Handler } from "@outfitter/contracts";
import { z } from "zod";

const ApproveInputSchema = z.object({
  pr: z.number().int().positive(),
  repo: z.string().min(1),
  body: z.string().optional(),
});

type ApproveInput = z.infer<typeof ApproveInputSchema>;

interface ApproveOutput {
  repo: string;
  pr: number;
  reviewId?: string;
  url?: string;
}

type ApproveErrors = AuthError | NotFoundError | NetworkError;

export const approveHandler: Handler<
  ApproveInput,
  ApproveOutput,
  ApproveErrors
> = async (input, ctx) => {
  ctx.logger.debug("Approving PR", { repo: input.repo, pr: input.pr });

  const [owner, name] = input.repo.split("/");
  const client = ctx.config?.get<GitHubClient>("githubClient");

  const reviewResult = await client.addReview(
    owner,
    name,
    input.pr,
    "approve",
    input.body
  );
  if (reviewResult.isErr()) {
    return reviewResult;
  }

  const review = reviewResult.value;
  return Result.ok({
    repo: input.repo,
    pr: input.pr,
    ...(review?.id && { reviewId: review.id }),
    ...(review?.url && { url: review.url }),
  });
};
```

### CLI Adapter (Thin Wrapper)

```typescript
// apps/cli/src/commands/approve.ts
import { exitWithError } from "@outfitter/cli/output";
import { output } from "@outfitter/cli";
import { approveHandler } from "@outfitter/firewatch-core/handlers";

export const approveCommand = command("approve")
  .argument("<pr>", "PR number", parseInt)
  .option("--repo <name>", "Repository (owner/repo)")
  .option("-b, --body <text>", "Approval message")
  .action(async ({ args, flags }) => {
    const result = await approveHandler(
      { pr: args.pr, repo: flags.repo, body: flags.body },
      ctx
    );

    if (result.isErr()) {
      exitWithError(result.error);
    }

    await output(result.value, { mode: flags.json ? "json" : undefined });
  })
  .build();
```

### MCP Adapter (Thin Wrapper)

```typescript
// apps/mcp/src/tools/approve.ts
import { defineTool } from "@outfitter/mcp";
import { approveHandler } from "@outfitter/firewatch-core/handlers";

export const approveTool = defineTool({
  name: "fw_approve",
  description: "Approve a PR",
  inputSchema: ApproveInputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  handler: async (input, ctx) => approveHandler(input, ctx),
});
```

### Handler Coverage

All operations have core handlers in `packages/core/src/handlers/`. CLI commands and MCP tools are thin adapters.

| Operation | Core Handler       | CLI Adapter   | MCP Tool    |
| --------- | ------------------ | ------------- | ----------- |
| approve   | `approveHandler`   | `approve.ts`  | `fw_pr`     |
| reject    | `rejectHandler`    | `reject.ts`   | `fw_pr`     |
| comment   | `commentHandler`   | `comment.ts`  | `fw_fb`     |
| reply     | `replyHandler`     | `reply.ts`    | `fw_fb`     |
| close     | `closeHandler`     | `close.ts`    | `fw_fb`     |
| edit      | `editHandler`      | `edit.ts`     | `fw_pr`     |
| ack       | `ackHandler`       | `ack.ts`      | `fw_fb`     |
| query     | `queryHandler`     | `query.ts`    | `fw_query`  |
| sync      | `syncHandler`      | `sync.ts`     | (internal)  |
| status    | `statusHandler`    | `status.ts`   | `fw_status` |
| doctor    | `doctorHandler`    | `doctor.ts`   | `fw_doctor` |
| freeze    | `freezePR`         | `freeze.ts`   | N/A         |
| unfreeze  | `unfreezePR`       | `unfreeze.ts` | N/A         |

---

## Pattern 2: Error Taxonomy

### Current State

Firewatch uses `AuthError`, `NetworkError`, and `NotFoundError` from contracts across core, CLI, and MCP. Core handlers return `Result.err()` with taxonomy errors. The CLI uses `exitWithError()` from `@outfitter/cli` which maps error categories to exit codes. The MCP server uses `adaptHandler()` from `@outfitter/mcp` to translate errors to JSON-RPC codes. Some CLI commands still have direct `console.error` + `process.exit(1)` for edge cases not covered by handlers (e.g., list, view, config).

### Target: Map All Failures to Taxonomy

| Current Pattern                                   | Maps To           | Category   | Exit Code |
| ------------------------------------------------- | ----------------- | ---------- | --------- |
| `throw new Error("requires pr")`                  | `ValidationError` | validation | 1         |
| `throw new Error("not found")`                    | `NotFoundError`   | not_found  | 2         |
| `throw new Error("auth required")`                | `AuthError`       | auth       | 9         |
| `throw new Error("invalid format")`               | `ValidationError` | validation | 1         |
| `throw new Error("sync failed")`                  | `NetworkError`    | network    | 7         |
| `throw new Error("config updates not supported")` | `PermissionError` | permission | 4         |

### CLI Error Handling

Replace:

```typescript
// Before
try {
  await doSomething();
} catch (error) {
  console.error("Failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
```

With:

```typescript
// After (using @outfitter/cli)
import { exitWithError } from "@outfitter/cli/output";

const result = await handler(input, ctx);
if (result.isErr()) {
  exitWithError(result.error); // Exit code from error.category
}
```

### MCP Error Handling

Replace:

```typescript
// Before
if (auth.isErr()) {
  throw new Error(auth.error.message); // Loses error category
}
```

With:

```typescript
// After (handler returns Result, @outfitter/mcp translates automatically)
if (auth.isErr()) {
  return auth; // Error category maps to JSON-RPC code
}
```

---

## Pattern 3: Structured Logging

### Current State

Firewatch has a custom logger in `packages/shared/src/logger.ts` that satisfies the `Logger` interface from `@outfitter/contracts`. It supports levels, child loggers, and stderr routing. But it lacks redaction, sinks, and environment-aware level resolution.

The CLI commands use `console.error()` and `console.log()` directly (~104 and ~60 instances respectively).

### Target: `@outfitter/logging`

```typescript
// Replace packages/shared/src/logger.ts with:
import {
  createLogger,
  createConsoleSink,
  resolveLogLevel,
} from "@outfitter/logging";

export function createFirewatchLogger(options?: { silent?: boolean }) {
  return createLogger({
    name: "firewatch",
    level: options?.silent ? "silent" : resolveLogLevel(),
    sinks: [createConsoleSink()],
    redaction: { enabled: true }, // Auto-redacts tokens, API keys
  });
}

export const silentLogger = createLogger({
  name: "firewatch",
  level: "silent",
  sinks: [],
});
```

Benefits:

- **Redaction**: GitHub tokens (`ghp_*`, `gho_*`) automatically redacted in log output
- **Environment-aware levels**: `OUTFITTER_LOG_LEVEL=debug` or `OUTFITTER_ENV=development` controls verbosity
- **Child loggers with context**: `logger.child({ repo: "outfitter-dev/firewatch", command: "sync" })`
- **File sink**: Could log to `~/.local/state/firewatch/debug.log` for diagnostics

### Migration Path

1. Install `@outfitter/logging`
2. Replace `createLogger` in shared with the `@outfitter/logging` version
3. Keep the `Logger` interface from `@outfitter/contracts` (both implementations satisfy it)
4. Gradually replace `console.error`/`console.log` calls with `ctx.logger.*` calls

---

## Pattern 4: CLI Framework (`@outfitter/cli`)

### Current State

Firewatch uses `createCLI()` from `@outfitter/cli` as the CLI entry point, providing global `--json` flag handling and `exitWithError()` for category-mapped exit codes. Commands are registered via `cli.register()` and use Commander v14. Key commands (approve, reject, comment, status, doctor, reply, edit) use `exitWithError()` for error handling.

### Target: `@outfitter/cli`

```typescript
// apps/cli/bin/fw.ts
import { createCLI } from "@outfitter/cli/command";
import { syncCommand } from "./commands/sync.js";
import { queryCommand } from "./commands/query.js";

const cli = createCLI({
  name: "fw",
  version: VERSION,
  description: "GitHub PR activity logger with JSONL output for jq composition",
});

cli.register(syncCommand);
cli.register(queryCommand);
// ...

await cli.parse();
```

### Key Benefits

| Feature          | Current (raw Commander)                     | With `@outfitter/cli`          |
| ---------------- | ------------------------------------------- | ------------------------------ |
| `--json` flag    | Manual per-command (`--jsonl`)              | Global, automatic              |
| Error exit codes | Always `1`                                  | Category-mapped (1-9, 130)     |
| Output mode      | `shouldOutputJson()` + `outputStructured()` | `output()` with auto-detection |
| Verbose mode     | `--debug` flag, manual                      | `resolveVerbose()`, env-aware  |
| Spinner          | `ora` directly                              | `@outfitter/tui/streaming`     |

### Rendering with `@outfitter/tui`

Firewatch already has custom rendering in `packages/core/src/render/` (box chars, tree rendering, truncation). These could be replaced with or complemented by `@outfitter/tui/render`:

```typescript
import {
  renderTable,
  renderTree,
  formatDuration,
  pluralize,
} from "@outfitter/tui/render";
```

---

## Pattern 5: MCP Server (`@outfitter/mcp`)

### Current State

Firewatch uses `createMcpServer()` and `defineTool()` from `@outfitter/mcp` with `connectStdio()` for transport. All 6 tools use `defineTool()` with `TOOL_ANNOTATIONS` presets (readOnly, destructive). Auth-gated write tools are registered after `connectStdio()` with `notifyToolsChanged()`. The `@modelcontextprotocol/sdk` is retained as a devDependency for types.

### Target: `@outfitter/mcp`

```typescript
// apps/mcp/src/server.ts
import { createMcpServer } from "@outfitter/mcp";
import { queryTool } from "./tools/query.js";
import { statusTool } from "./tools/status.js";
import { prTool } from "./tools/pr.js";
import { feedbackTool } from "./tools/feedback.js";

const server = createMcpServer({
  name: "firewatch",
  version: mcpVersion,
  logger: firewatchLogger,
});

// Base tools (always available)
server.registerTool(queryTool);
server.registerTool(statusTool);
server.registerTool(doctorTool);
server.registerTool(helpTool);

// Write tools (auth-gated registration stays manual)
if (authVerified) {
  server.registerTool(prTool);
  server.registerTool(feedbackTool);
}

await server.start();
```

### Tool Definition with `defineTool`

```typescript
// apps/mcp/src/tools/query.ts
import { defineTool } from "@outfitter/mcp";
import { queryHandler } from "@outfitter/firewatch-core/handlers";

export const queryTool = defineTool({
  name: "fw_query",
  description:
    "Query cached PR activity (reviews, comments, commits, CI). Outputs JSONL.",
  inputSchema: QueryInputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true, // May trigger auto-sync to GitHub
  },
  deferLoading: false, // Core tool, always listed
  handler: async (input, ctx) => queryHandler(input, ctx),
});
```

### Benefits

- **Tool annotations**: Clients know `fw_query` is read-only, `fw_pr` is destructive
- **Deferred loading**: Domain tools load on demand, core tools always visible
- **Automatic error translation**: `Result.err(NotFoundError)` becomes JSON-RPC `-32601`
- **Log forwarding**: Server can send structured log messages to MCP clients
- **Resource support**: Could expose cached PR data as addressable resources

---

## Pattern 6: XDG Config Paths (`@outfitter/config`)

### Current State

Firewatch uses `env-paths` (npm package) for XDG path resolution in `packages/core/src/cache.ts`:

```typescript
import envPaths from "env-paths";
const paths = envPaths("firewatch");
```

### Target: `@outfitter/config`

```typescript
import {
  getConfigDir,
  getCacheDir,
  getDataDir,
  getStateDir,
} from "@outfitter/config";

const configDir = getConfigDir("firewatch"); // ~/.config/firewatch
const cacheDir = getCacheDir("firewatch"); // ~/.cache/firewatch
const stateDir = getStateDir("firewatch"); // ~/.local/state/firewatch
```

This eliminates the `env-paths` dependency. The `@outfitter/config` functions handle XDG env vars (`$XDG_CONFIG_HOME`, etc.) and platform differences.

---

## Pattern 7: Validation with `createValidator`

### Current State

Firewatch uses Zod schemas in `packages/core/src/schema/` for type definitions but validates manually in command handlers. The MCP server has separate `*ParamsShape` schemas in `apps/mcp/src/schemas.ts`.

### Target

```typescript
import { createValidator } from "@outfitter/contracts";

const validateQueryInput = createValidator(QueryInputSchema);

export const queryHandler: Handler<unknown, QueryOutput, QueryErrors> = async (
  rawInput,
  ctx
) => {
  const inputResult = validateQueryInput(rawInput);
  if (inputResult.isErr()) {
    return inputResult; // ValidationError with Zod details
  }
  const input = inputResult.value; // Fully typed

  // Business logic with validated input...
};
```

This replaces the manual validation scattered across CLI and MCP with a single validation point at handler entry.

---

## Pattern 8: Testing

### Current State

Firewatch has ~200 tests using `bun:test`. Tests are colocated in `tests/` directories within packages. Core function tests call functions directly.

### Target Additions with `@outfitter/testing`

```typescript
import {
  createFixture,
  withTempDir,
  withEnv,
  createMockLogger,
} from "@outfitter/testing";

// Test fixtures for entries
const createEntry = createFixture<FirewatchEntry>({
  id: "test-id",
  repo: "owner/repo",
  pr: 1,
  type: "comment",
  author: "testuser",
  // ...
});

// Environment testing
test("uses custom cache dir", async () => {
  await withEnv({ XDG_CACHE_HOME: "/tmp/test-cache" }, async () => {
    const paths = getConfigPaths();
    expect(paths.cache).toStartWith("/tmp/test-cache");
  });
});

// Logger verification
test("logs sync progress", async () => {
  const mockLogger = createMockLogger();
  const ctx = createContext({ logger: mockLogger });

  await syncHandler({ repo: "owner/repo" }, ctx);

  expect(mockLogger.calls.info).toContainEqual([
    "Sync complete",
    expect.objectContaining({ entriesAdded: expect.any(Number) }),
  ]);
});
```

---

## Adoption Status

### Completed

- **Phase 0**: Upgraded `@outfitter/contracts` to ^0.4.1
- **Phase 1**: All 12 handlers extracted to `packages/core/src/handlers/`
- **Phase 3**: CLI uses `createCLI()` from `@outfitter/cli`, `exitWithError()` wired on key commands
- **Phase 4**: MCP uses `createMcpServer()` + `defineTool()` from `@outfitter/mcp`

### Remaining

- **Phase 2**: Adopt `@outfitter/logging` — Replace custom logger in shared with `@outfitter/logging` for redaction, sinks, environment-aware levels
- **Phase 5**: Adopt `@outfitter/config` — Replace `env-paths` with `getConfigDir()`, `getCacheDir()` from `@outfitter/config`
- **Remaining CLI migration**: Wire list, view, config, freeze, unfreeze, schema, examples commands to use `exitWithError()` and core handlers
- **Remaining output migration**: Replace remaining `console.log`/`console.error` calls with `output()` from `@outfitter/cli`

---

## Remaining Anti-Patterns

| Anti-Pattern               | Location                                        | Fix                                           |
| -------------------------- | ----------------------------------------------- | --------------------------------------------- |
| `process.exit(1)` in CLI   | list, view, config, freeze, unfreeze, schema    | Use `exitWithError()`                         |
| `console.error()` in CLI   | Same commands as above                          | Use `ctx.logger.error()` or `exitWithError()` |
| `console.log()` in core    | `packages/core/src/query.ts:224`                | Return data, let adapter output               |
| Custom logger in shared    | `packages/shared/src/logger.ts`                 | Replace with `@outfitter/logging`             |
| `env-paths` dep in core    | `packages/core/src/cache.ts`                    | Replace with `@outfitter/config`              |

---

## File Layout After Full Adoption

```
packages/
  core/
    src/
      handlers/           # NEW: Transport-agnostic handlers
        approve.ts
        reject.ts
        comment.ts
        reply.ts
        close.ts
        ack.ts
        edit.ts
        freeze.ts
        query.ts
        sync.ts
        status.ts
        doctor.ts
        index.ts
      auth.ts             # Already returns Result
      github.ts           # Already returns Result
      time.ts             # Already returns Result
      freeze.ts           # Already returns Result
      ...
  shared/
    src/
      logger.ts           # Replaced by @outfitter/logging

apps/
  cli/
    src/
      commands/           # Thin adapters calling handlers
        approve.ts        # ~20 lines: parse args, call handler, output
        ...
  mcp/
    src/
      tools/              # NEW: defineTool() wrappers
        query.ts
        status.ts
        pr.ts
        feedback.ts
      index.ts            # Simplified: createMcpServer + register tools
```

---

## Quick Reference: Error Category Mapping

| Firewatch Domain Error  | Taxonomy Error    | Category   | Exit | HTTP |
| ----------------------- | ----------------- | ---------- | ---- | ---- |
| No auth found           | `AuthError`       | auth       | 9    | 401  |
| PR not found            | `NotFoundError`   | not_found  | 2    | 404  |
| Comment not found       | `NotFoundError`   | not_found  | 2    | 404  |
| Invalid PR number       | `ValidationError` | validation | 1    | 400  |
| Invalid duration format | `ValidationError` | validation | 1    | 400  |
| Invalid repo format     | `ValidationError` | validation | 1    | 400  |
| GitHub API failure      | `NetworkError`    | network    | 7    | 502  |
| GitHub rate limit       | `RateLimitError`  | rate_limit | 6    | 429  |
| Config write via MCP    | `PermissionError` | permission | 4    | 403  |
| Short ID ambiguous      | `ValidationError` | validation | 1    | 400  |
| Sync timeout            | `TimeoutError`    | timeout    | 5    | 504  |
| User cancelled          | `CancelledError`  | cancelled  | 130  | 499  |
