# Firewatch Engineer Memory

## Handler Pattern (established PR #2 / FIRE-4)

- Handler contract: `(input: TInput, ctx: HandlerContext) => Promise<Result<TOutput, Error>>`
- `HandlerContext` = `{ config: FirewatchConfig, db: Database, logger: Logger }`
- Handlers in `packages/core/src/handlers/`
- Tests in `packages/core/tests/handlers/`
- CLI and MCP are thin adapters: build context, call handler, format output
- `silentLogger` from `@outfitter/firewatch-shared` for test/production contexts

## Handlers Implemented (PR #3 / FIRE-5)

- `doctorHandler` in `packages/core/src/handlers/doctor.ts`
  - Runs 6 checks: github reachable, auth, config parse, cache writable, repo detection, graphite CLI
  - Returns `DoctorCheckResult[]` + graphite info + counts
  - CLI/MCP adapt the structured output to their own shapes
- `queryHandler` in `packages/core/src/handlers/query.ts`
  - Builds QueryOptions from QueryInput, calls queryEntries, applies client-side filters
  - Optionally builds worklist summary (summary=true)
  - Does NOT handle sync (transport concern)
- Naming collision: core exports `CheckResult` from `./check` AND `DoctorCheckResult` from handlers

## exactOptionalPropertyTypes Gotchas

- All optional interface properties in handlers must use `prop?: Type | undefined` (not just `prop?: Type`)
- `Result.ok()` without argument returns `Ok<void>`, not `Ok<undefined>` -- use typed variable for undefined
- `QueryOptions["filters"]` resolves to `QueryFilters | undefined` -- use `QueryFilters` directly as return type

## Key API Shapes

- `setSyncMeta(db, meta: SyncMetadata)` where SyncMetadata = `{ repo, scope, last_sync, cursor?, pr_count }`
- FirewatchEntry requires `captured_at` field (NOT NULL constraint)
- `Result` from `@outfitter/contracts` has `.isOk()`, `.isErr()`, `.unwrap()`, `.value`, `.error`

## Build Artifacts

- `packages/shared/src/*.d.ts` files are tsc composite build artifacts
- They cause pre-existing oxlint errors (no-useless-empty-export) -- not our problem
- `bun run check` = oxlint + `bun run --filter '*' check` (tsc -b per package)
- Only tsc errors are meaningful; the oxlint .d.ts errors are pre-existing

## Workspace Dependencies

- CLI added `@outfitter/firewatch-shared` as dependency + tsconfig reference (PR #2)
- MCP added `@outfitter/firewatch-shared` as dependency + tsconfig reference (PR #2)
- Both needed for `silentLogger` import when building HandlerContext

## MCP Framework Migration (PR FIRE-11)

- MCP server uses `@outfitter/mcp` (createMcpServer, defineTool, connectStdio, TOOL_ANNOTATIONS)
- `@modelcontextprotocol/sdk` moved to devDependencies (only used in integration tests)
- Peer deps needed: `@outfitter/logging@>=0.4.1` (0.3.0 missing `createOutfitterLoggerFactory`), `@outfitter/config@>=0.3.0`, `@outfitter/contracts@>=0.2.0`
- `adaptHandler()` bridges `Error` -> `OutfitterError` for handlers returning `Result.err(Error)`
- defineTool handler type: `Handler<TInput, TOutput, TError extends OutfitterError>` -- plain Error doesn't satisfy
- Integration tests use `createSdkServer(mcpServer)` to get SDK Server for InMemoryTransport
- `notifyToolsChanged()` replaces `sendToolListChanged()` for auth-gated dynamic tool registration
- `*ParamsSchema` (z.object) used as `inputSchema` in defineTool; `*ParamsShape` kept for backward compat
