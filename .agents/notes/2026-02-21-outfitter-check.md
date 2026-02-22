# Compliance Report: packages/core/ and apps/

**Date**: 2026-02-21
**Scope**: `packages/core/`, `apps/cli/`, `apps/mcp/`
**Status**: FAIL

## Summary

| Severity | Count |
| -------- | ----- |
| Critical | 3     |
| High     | 3     |
| Medium   | 4     |
| Low      | 3     |

---

## Critical

### C1. Thrown exceptions in core library (2 sites)

The core library is the handler layer -- it should return `Result<T, E>` for all failure paths. Two functions still throw.

| Location                         | Issue                                                                 |
| -------------------------------- | --------------------------------------------------------------------- |
| `packages/core/src/sync.ts:540`  | `throw new Error("Invalid repo format")` in `syncRepo()`              |
| `packages/core/src/config.ts:24` | `throw new TypeError("Invalid integer value")` in `parseEnvInteger()` |

**Fix**: `syncRepo()` should return `Result<SyncResult, ValidationError>`. `parseEnvInteger()` is called inside `applyEnvOverrides()` which already wraps it in try/catch -- consider making it return `Result` or documenting the throw as intentionally caught at the call site. See [patterns/conversion.md].

### C2. Thrown exceptions in MCP server (80 sites across 2 files)

The MCP server has **75 `throw new` statements** in `apps/mcp/src/index.ts` (2,348 lines) and **5** in `apps/mcp/src/query.ts`. These are inside MCP tool handlers. While `@modelcontextprotocol/sdk` catches them, the error category, exit code, and retry semantics are lost -- agents receive opaque `InternalError` responses they cannot reason about.

| Location                | Count | Issue                              |
| ----------------------- | ----- | ---------------------------------- |
| `apps/mcp/src/index.ts` | 75    | Thrown exceptions in tool handlers |
| `apps/mcp/src/query.ts` | 5     | Thrown exceptions in query helpers |

Key examples:

- `:228` `throw new Error("edit requires pr.")` -- should be `ValidationError`
- `:435` `throw new Error("Cannot resolve short ID")` -- should be `NotFoundError`
- `:463` `throw new Error(auth.error.message)` -- unwraps a typed `AuthError` into bare `Error`
- `:920` `throw new Error(reviewResult.error.message)` -- loses `NetworkError` context

**Fix**: Extract handler functions returning `Result<T, E>`, then wire thin MCP tool adapters. Short-term: return MCP error responses with category metadata instead of throwing. Adopting `@outfitter/mcp` with `defineTool()` would enforce this pattern naturally. See [patterns/mcp.md], [patterns/conversion.md].

### C3. Thrown exceptions in CLI (25 sites across 9 files)

CLI commands and shared helpers throw instead of returning Results.

| Location                                 | Count | Issue                            |
| ---------------------------------------- | ----- | -------------------------------- |
| `apps/cli/src/query-helpers.ts`          | 5     | Throws in shared query helpers   |
| `apps/cli/src/query.ts`                  | 6     | Throws for input validation      |
| `apps/cli/src/repo.ts`                   | 3     | Throws in repo resolution        |
| `apps/cli/src/commands/ack.ts`           | 7     | Throws in ack command            |
| `apps/cli/src/commands/reply.ts`         | 1     | Throws when thread not found     |
| `apps/cli/src/commands/list.ts`          | 1     | Throws TypeError                 |
| `apps/cli/src/commands/config.ts`        | 2     | Throws for missing config/editor |
| `apps/cli/src/commands/claude-plugin.ts` | 3     | Throws for shell failures        |
| `apps/cli/src/utils/states.ts`           | 1     | Throws for invalid states        |

**Fix**: CLI commands are transport boundaries, so outermost try/catch with `process.exit()` is acceptable. However, shared helpers (`query-helpers.ts`, `repo.ts`, `utils/states.ts`) are reusable functions that should return `Result` so callers can handle errors structurally. See [patterns/cli.md], [patterns/conversion.md].

---

## High

### H1. No structured logging -- 264 console.\* calls across 33 files

The codebase uses raw `console.log/error/warn` everywhere. A `createLogger()` exists in `packages/shared/` implementing the contracts `Logger` interface, but it is **never used** by any command or handler. Zero `ctx.logger` references exist.

| Location                          | Count | Issue                                    |
| --------------------------------- | ----- | ---------------------------------------- |
| `apps/cli/src/commands/*.ts`      | ~200  | Raw console output in all CLI commands   |
| `packages/core/src/config.ts:154` | 1     | `console.error` for config parse warning |
| `packages/core/src/query.ts`      | 1     | `console.error` for empty results        |
| `apps/mcp/bin/fw-mcp.ts`          | 3     | Raw console for startup/shutdown         |

**Assessment**: For CLI user-facing output, `console.log` for stdout is partially acceptable at the transport boundary. But the core library should never use `console.*` directly -- those 2 sites should use a logger passed via context. Diagnostic and error output across all layers should route through structured logging.

**Fix**: Wire the existing shared logger into a `HandlerContext`. Adopt `@outfitter/logging` for structured output with redaction. See [patterns/logging.md].

### H2. No handler abstraction -- business logic inlined in transport adapters

Zero `Handler<TInput, TOutput, TError>` signatures. No `HandlerContext` type. No `createValidator()`. All business logic lives directly in transport-specific code:

| Location                     | Issue                                                |
| ---------------------------- | ---------------------------------------------------- |
| `apps/mcp/src/index.ts`      | 2,348 lines -- all 6 MCP tools inline in one file    |
| `apps/cli/src/commands/*.ts` | Each command has business logic coupled to Commander |

The CLI and MCP duplicate significant logic (repo resolution, auth checking, query building, sync orchestration). There is no shared handler layer that both surfaces call.

**Fix**: Extract domain operations into handler functions in `packages/core/`. Signature: `(input: TInput, ctx: HandlerContext) => Promise<Result<TOutput, TError>>`. CLI and MCP become thin adapters that validate input, call the handler, and format output. The existing `apps/mcp/src/query.ts` is a partial extraction but still throws. See [patterns/handler.md].

### H3. Custom XDG + config implementation instead of @outfitter/config

`packages/core/src/cache.ts` uses `env-paths` with a custom 38-line `resolvePaths()` for macOS XDG overrides. `packages/core/src/config.ts` is a custom 585-line implementation: TOML parser, deep merge, env variable override system, and serializer.

| Location                          | Lines | Issue                                                  |
| --------------------------------- | ----- | ------------------------------------------------------ |
| `packages/core/src/cache.ts:1-38` | 38    | Custom `resolvePaths()` duplicates `@outfitter/config` |
| `packages/core/src/config.ts`     | 585   | Custom TOML parser, merge, env overrides, serializer   |

**Fix**: `@outfitter/config` v0.3.0 provides `getConfigDir()`, `getCacheDir()`, `getDataDir()` with XDG support, plus config loading with deep merge and env overrides. This would eliminate the `env-paths` dependency and ~620 lines of custom code. See agent memory on `@outfitter/config` v0.3.0.

---

## Medium

### M1. No .describe() on MCP Zod schema fields

All 50+ Zod schema fields in `apps/mcp/src/schemas.ts` lack `.describe()` annotations. MCP clients (agents) use these descriptions to understand tool parameters. Without them, agents rely solely on the tool-level description string.

| Location                                           | Issue                                        |
| -------------------------------------------------- | -------------------------------------------- |
| `apps/mcp/src/schemas.ts` (entire file, 167 lines) | Zero `.describe()` calls on any schema field |

**Fix**: Add `.describe()` to each field. Example:

```typescript
since: z.string().describe("Time window, e.g. '24h', '7d'").optional();
```

Quick win with high impact on agent experience. See [patterns/mcp.md].

### M2. repo-detect.ts returns custom types instead of Result

`detectRepo()` returns `RepoDetectResult` with `repo: string | null` and `source: ... | null`. The null pattern loses error context. `getPrForCurrentBranch()` returns `BranchPrResult` with `error?: string`.

| Location                                   | Issue                                          |
| ------------------------------------------ | ---------------------------------------------- |
| `packages/core/src/repo-detect.ts:6-13`    | Custom `RepoDetectResult` with nullable fields |
| `packages/core/src/repo-detect.ts:241-248` | Custom `BranchPrResult` with `error?: string`  |

**Fix**: Convert to `Result<{repo, source}, NotFoundError>` and `Result<{pr, branch}, NotFoundError>`.

### M3. Deprecated AuthResult type still exported

| Location                          | Issue                                             |
| --------------------------------- | ------------------------------------------------- |
| `packages/core/src/auth.ts:21-25` | `@deprecated` AuthResult interface still exported |

**Fix**: Audit callers and remove if unused.

### M4. parity.ts uses custom result type

`compareParityData()` returns `ParityResult` with `match: boolean` -- a custom success/failure discriminant.

| Location                            | Issue                                       |
| ----------------------------------- | ------------------------------------------- |
| `packages/core/src/parity.ts:67-74` | Custom `ParityResult` with `match: boolean` |

**Fix**: Low priority. The parity module is a comparison tool, not a fallible operation. The `match` boolean is semantically distinct from ok/err. Consider leaving as-is.

---

## Low

### L1. process.exit(1) without exitWithError() -- 55 CLI sites

All CLI error exits use `process.exit(1)` regardless of error category. The Outfitter taxonomy maps 10 categories to specific exit codes.

| Location                     | Count |
| ---------------------------- | ----- |
| `apps/cli/src/commands/*.ts` | ~50   |
| `apps/cli/bin/fw.ts`         | 3     |
| `apps/cli/src/index.ts`      | 3     |

**Fix**: Adopt `exitWithError()` from `@outfitter/cli` to map error categories to exit codes: `AuthError` -> 9, `ValidationError` -> 1, `NetworkError` -> 7, etc. See [patterns/cli.md].

### L2. @outfitter/contracts at 0.1.0 -- 0.4.1 available (breaking)

| Package                | Current | Available | Type     |
| ---------------------- | ------- | --------- | -------- |
| `@outfitter/contracts` | 0.1.0   | 0.4.1     | breaking |

**Fix**: Review changelog, then upgrade. Expected improvements: `static create()` factories, `expect()` for boundary unwrapping.

### L3. Logger exists but is never wired

`packages/shared/src/logger.ts` implements contracts `Logger` with `createLogger()` and `silentLogger`, built during the contracts adoption. It is exported but used by zero callers.

| Location                        | Issue                                |
| ------------------------------- | ------------------------------------ |
| `packages/shared/src/logger.ts` | Logger implementation exists, unused |

**Fix**: Wire into `HandlerContext` once the handler abstraction (H2) is built.

---

## Migration Guidance

**Installed versions:**

| Package                | Version |
| ---------------------- | ------- |
| `@outfitter/contracts` | ^0.1.0  |

**Updates available:**

| Package                | Current | Available | Type     |
| ---------------------- | ------- | --------- | -------- |
| `@outfitter/contracts` | 0.1.0   | 0.4.1     | breaking |

**Not yet adopted:**

| Package              | Available | Would Replace                                              |
| -------------------- | --------- | ---------------------------------------------------------- |
| `@outfitter/cli`     | 0.3.0     | Raw Commander + console.log + process.exit(1)              |
| `@outfitter/mcp`     | 0.3.0     | Raw @modelcontextprotocol/sdk + throw-based error handling |
| `@outfitter/logging` | 0.3.0     | Custom logger in packages/shared (built but unused)        |
| `@outfitter/config`  | 0.3.0     | Custom 585-line TOML parser + env-paths dependency         |

**Migration guide**: `outfitter upgrade --guide` reports no automated migration steps for contracts 0.1.0 -> 0.4.1. Manual changelog review required.

---

## Recommendations

Prioritized by impact and dependency order:

1. **Extract handler layer** (H2) -- Foundation for everything else. Extract domain operations from `apps/mcp/src/index.ts` (2,348 lines) and CLI commands into `packages/core/` as `(input, ctx) => Result<T, E>` functions. This is the largest effort but unblocks all other improvements.

2. **Convert core throws to Result** (C1) -- Fix the 2 remaining throws in `sync.ts` and `config.ts`. Quick win, completes the core library migration.

3. **Adopt @outfitter/config** (H3) -- Replace `env-paths` + custom TOML parser + env override logic. Eliminates ~620 lines of custom code and one dependency.

4. **Add .describe() to MCP schemas** (M1) -- Quick win for agent experience. No logic changes, just annotations.

5. **Upgrade @outfitter/contracts** (L2) -- Move from 0.1.0 to 0.4.1. Get `static create()` factories and `expect()` utility.

6. **Convert MCP throws to typed errors** (C2) -- After handler extraction, convert remaining MCP throw sites to typed error responses with category metadata.

7. **Convert CLI shared helpers to Result** (C3) -- `query-helpers.ts`, `repo.ts`, `utils/states.ts` should return Result types.

8. **Adopt @outfitter/cli** (L1) -- Replace raw Commander patterns with `createCLI()`, `exitWithError()`, proper exit code mapping.

9. **Adopt @outfitter/mcp** (C2 long-term) -- Replace raw SDK usage with `defineTool()` + typed handlers.

10. **Wire structured logging** (H1, L3) -- Connect existing logger to `HandlerContext`, adopt `@outfitter/logging`.

---

## What's Working Well

- **Result types in core**: `auth.ts`, `github.ts`, `time.ts`, `freeze.ts` use `Result<T, E>` correctly (120 Result.ok/err in core, 110 isOk/isErr checks in apps)
- **Error taxonomy usage**: `AuthError`, `NetworkError`, `NotFoundError`, `ValidationError` used correctly where Result is adopted
- **Zero custom error classes**: No `class FooError extends Error` -- all errors use contracts taxonomy
- **Bun-native APIs**: `Bun.file()`, `Bun.write()`, `Bun.$`, `bun:sqlite` throughout
- **Logger interface**: Contracts `Logger` type correctly implemented in shared package
- **Zod input validation**: MCP tool schemas use Zod for all input validation
- **XDG compliance**: Cache/config paths are XDG-aware at runtime (even if via custom code)

---

## Pass Criteria

- [x] 0 custom error classes
- [x] No hardcoded paths at runtime (only in docs/comments)
- [ ] 0 critical issues -- **107 throw sites** (2 core + 80 MCP + 25 CLI)
- [ ] 0 high issues -- **264 console.\* sites, no handler abstraction, custom config**
- [ ] All handlers return `Result<T, E>` -- **core partially done, no handler layer exists**
- [ ] No `throw` in application code -- **107 remaining**
- [ ] No `console.log` in library code -- **2 in core, 264 total**
