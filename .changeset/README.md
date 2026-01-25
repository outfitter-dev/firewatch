# Changesets

## Adding a Changeset

Run `bun run changeset` when your PR:

- Adds a feature (minor)
- Fixes a bug (patch)
- Makes breaking changes (major)

Skip for docs-only or tooling changes.

## Stacked PRs (Graphite)

Each PR in a stack gets its own changeset:

```bash
# PR 1
gt create 'feat/query-filter' -am "feat: add regex filter"
bun run changeset
gt modify -a

# PR 2 (stacked)
gt create 'feat/filter-flag' -am "feat: add --filter flag"
bun run changeset
gt modify -a

gt submit --stack
```

Changeset files have random names - no conflicts on rebase.

## Release Flow

1. PRs merge to main (with changesets)
2. Bot creates "Version Packages" PR
3. Review CHANGELOG, merge when ready
4. npm publish + binary release automatic

## Common Commands

- `bun run changeset` to create a new changeset
- `bun run version-packages` to apply version bumps + changelog updates
- `bun run release` to publish packages
