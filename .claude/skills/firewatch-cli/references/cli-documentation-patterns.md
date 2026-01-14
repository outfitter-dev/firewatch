# CLI Documentation Best Practices

Research findings from modern CLI tools: gh CLI, ripgrep, jq, HTTPie, npm.

## Standard Directory Structure

Well-documented CLI tools follow consistent patterns:

```
docs/
├── commands/              # Per-command reference
│   ├── README.md          # Command index with quick reference table
│   ├── sync.md
│   ├── query.md
│   └── ...
├── development/           # Contributor/integration guides
│   └── github-integration.md
├── configuration.md       # Config file reference
├── schema.md              # Output schema reference
├── cookbook.md            # Practical patterns/recipes
└── mcp.md                 # Integration docs
```

## Essential Documentation Types

### 1. Quick Reference Table

**Pattern from**: gh CLI, npm

Every command index should have a scannable table:

```markdown
| Command | Description |
|---------|-------------|
| `fw sync` | Fetch and update PR data from GitHub |
| `fw query` | Filter and output cached entries |
```

### 2. Per-Command Reference

**Pattern from**: npm, gh CLI

Structure for each command doc:

```markdown
# command-name

One-line description.

## Synopsis

\`\`\`bash
fw command [options]
\`\`\`

## Description

What the command does and when to use it. 2-3 paragraphs max.

## Options

| Option | Description |
|--------|-------------|
| `--flag <value>` | What it does |

## Examples

\`\`\`bash
# Common use case
fw command --flag value

# Another pattern
fw command --other-flag
\`\`\`

## See Also

- [Related Command](./related.md)
```

### 3. User Guide (GUIDE.md)

**Pattern from**: ripgrep

Long-form tutorial covering:
- Basics with progressive complexity
- Common workflows
- Configuration
- Advanced features

ripgrep's GUIDE.md is ~1000 lines with table of contents:

```markdown
## User Guide

### Table of Contents
- [Basics](#basics)
- [Recursive search](#recursive-search)
- [Configuration file](#configuration-file)
- [Common options](#common-options)

### Basics
[Progressive content with examples...]
```

### 4. Cookbook / Recipes

**Pattern from**: jq, HTTPie

Practical patterns organized by task:

```markdown
# Cookbook

## Filtering
\`\`\`bash
fw query | jq 'select(.type == "review")'
\`\`\`

## Aggregation
\`\`\`bash
fw query | jq -s 'group_by(.pr) | map({pr: .[0].pr, count: length})'
\`\`\`
```

### 5. Schema Reference

**Pattern from**: Stripe API, GraphQL APIs

For structured output, document every field:

```markdown
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier |
| `author` | string | Yes | Username |
| `body` | string | No | Content text |
```

## Key Principles

### From Draft.dev Best Practices

1. **Go in-depth on features AND use cases** - Explain what, how, and why
2. **Create high-level summaries** - Quick-start guides for new users
3. **Use examples extensively** - Ready-to-run, complete examples
4. **Prioritize navigation** - Clear paths from getting started to reference
5. **Make searchable** - TOC, anchors, internal links

### From gh CLI

1. **Help text embedded in source** - `pkg/cmd/<command>/<command>.go`
2. **Auto-generated manual pages** - Build process converts help to man pages
3. **Non-command topics** - `gh help environment` for concepts

### From ripgrep

1. **Progressive complexity** - Start simple, build to advanced
2. **Real examples** - Search actual source code
3. **Configuration documentation** - Show every config option with examples
4. **Common options section** - Highlight most-used flags

### From jq

1. **Versioned documentation** - Link to docs for each version
2. **Single comprehensive manual** - All built-in functions in one page
3. **Filter-by-filter reference** - Every operator documented

## Anti-Patterns

| Anti-Pattern | Better Approach |
|--------------|-----------------|
| Missing examples | Every feature has runnable examples |
| Incomplete synopses | Show all options in synopsis |
| No table of contents | Always include TOC for docs > 100 lines |
| Buried reference | Put schema/reference in dedicated files |
| Outdated examples | Review docs with each release |

## Firewatch Documentation Status

Current structure aligns well with best practices:

**Strong:**
- `docs/commands/` - Per-command reference ✓
- `docs/jq-cookbook.md` - Practical patterns ✓
- `docs/schema.md` - Output schema reference ✓
- `docs/configuration.md` - Config reference ✓

**Opportunities:**
- Consider root-level `GUIDE.md` for progressive tutorial
- Add more cross-linking between related commands
- Expand cookbook with agent-specific patterns

## Sources

- [gh CLI project-layout.md](https://github.com/cli/cli/blob/trunk/docs/project-layout.md)
- [ripgrep GUIDE.md](https://github.com/BurntSushi/ripgrep/blob/master/GUIDE.md)
- [jq Manual](https://jqlang.github.io/jq/manual/)
- [npm Docs](https://docs.npmjs.com/cli/)
- [Draft.dev: Documentation Best Practices for Developer Tools](https://draft.dev/learn/documentation-best-practices-for-developer-tools)
