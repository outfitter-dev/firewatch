# Contributing to Firewatch

Thank you for considering contributing to Firewatch! This document outlines how to set up your development environment and the guidelines for contributing.

## Development Setup

### Prerequisites

- [Bun](https://bun.sh/) v1.0 or later
- [gh CLI](https://cli.github.com/) (recommended for authentication)
- Git

### Getting Started

1. Clone the repository:

   ```bash
   git clone https://github.com/outfitter-dev/firewatch.git
   cd firewatch
   ```

2. Install dependencies:

   ```bash
   bun install
   ```

3. Run the CLI in development mode:

   ```bash
   bun run dev
   ```

4. Or run directly:

   ```bash
   bun apps/cli/bin/fw.ts --summary
   bun apps/cli/bin/fw.ts --since 24h --type review
   ```

### Development Commands

```bash
bun run dev              # Run CLI with --watch for development
bun run build            # Build all packages
bun run check            # Lint (oxlint) + type check (tsc --noEmit)
bun run test             # Run tests with bun test
bun run lint             # Run oxlint
bun run lint:fix         # Run oxlint with auto-fix
bun run format           # Run oxfmt
```

### Symlink for Local Testing

Create a dev alias to test locally:

```bash
./scripts/symlink-dev.sh        # Creates fw-dev
./scripts/symlink-dev.sh myfw   # Custom alias
```

## Project Structure

```
firewatch/
├── apps/
│   ├── cli/           # CLI application (fw binary)
│   └── mcp/           # MCP server for AI agents
├── packages/
│   ├── core/          # Core library (auth, cache, sync, query)
│   ├── claude-plugin/ # Local Claude Code plugin marketplace
│   └── shared/        # Shared types and utilities
├── docs/              # Documentation
└── scripts/           # Build and development scripts
```

## Code Style

### Formatting and Linting

This project uses [Ultracite](https://github.com/outfitter-dev/ultracite) (oxlint + oxfmt) for code quality:

```bash
bun run check      # Check for issues
bun run lint:fix   # Auto-fix lint issues
bun run format     # Format code
```

### TypeScript Guidelines

- Use strict mode (no `any` types)
- Prefer `unknown` with type guards over `any`
- Use Zod schemas for runtime validation
- Export types separately from implementations
- Use `satisfies` for type validation where appropriate

### Naming Conventions

- `camelCase` for variables and functions
- `PascalCase` for types, interfaces, and classes
- `kebab-case` for CLI flags and file names
- `SCREAMING_SNAKE_CASE` for constants

## Commit Guidelines

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new query filter for labels
fix: handle empty cache gracefully
docs: update CLI reference
chore: update dependencies
refactor: simplify auth detection logic
test: add tests for worklist aggregation
```

### Commit Size

- One idea per commit
- Typically 20-100 effective lines of code
- Touch 1-5 files per commit
- Isolate mechanical changes (formatting, renames) in their own commits

## Pull Request Process

### Preferred: Stacked PRs with Graphite

We use [Graphite](https://graphite.dev/) for stacked PRs. If you have access:

```bash
gt create -m "feat: add new feature"
gt submit --stack
```

### Standard PRs

1. Create a feature branch from `main`
2. Make your changes with clear, atomic commits
3. Ensure `bun run check` passes
4. Open a PR with a clear description

### PR Guidelines

- **Size**: Aim for ~100-250 lines of code, 8 or fewer files
- **Description**: Explain what and why, not just how
- **Tests**: Add tests for new functionality
- **Docs**: Update documentation for user-facing changes

## Testing

Tests use Bun's built-in test runner:

```bash
bun test                    # Run all tests
bun test --watch            # Watch mode
bun test path/to/file.test.ts  # Specific file
```

### Test Guidelines

- Colocate tests with modules (`*.test.ts`) or place in `tests/`
- Focus on core logic before CLI wiring
- Use real examples where possible

## Architecture Notes

### Layered Design

- `packages/core/` contains interface-agnostic logic
- `apps/cli/` wires core to Commander.js
- `apps/mcp/` wires core to MCP protocol

### Key Patterns

- **Denormalized JSONL**: Each entry is self-contained
- **Adaptive auth**: gh CLI -> env vars -> config token
- **Plugin enrichment**: Graphite metadata during sync
- **Incremental sync**: Cursor-based pagination

See `AGENTS.md` for more architectural details.

## Questions?

- Open an issue for bugs or feature requests
- Start a discussion for questions or ideas
- Check existing issues before creating new ones

Thank you for contributing!
