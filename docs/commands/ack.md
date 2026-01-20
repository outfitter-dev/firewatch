# `fw ack`

Acknowledge feedback comments locally, with an optional GitHub reaction.

## Usage

```bash
fw ack <comment-id> [--repo owner/repo]
fw ack --list [--repo owner/repo]
fw ack --clear <comment-id> [--repo owner/repo]
```

## Options

- `--repo <owner/repo>`: Specify the repository when not running inside a repo
- `--list`: List acknowledged comments
- `--clear <comment-id>`: Remove an acknowledgement
- `--jsonl` / `--no-jsonl`: Force output mode

## Notes

- Comment IDs can be full GraphQL IDs or short `@id` values.
- Acknowledgements are stored locally in `~/.cache/firewatch/acked.jsonl`.

## Examples

```bash
# Acknowledge a comment
fw ack IC_kwDOQ... --repo outfitter-dev/firewatch

# Acknowledge by short id (in repo)
fw ack @a7f3c

# List all acknowledgements
fw ack --list

# Clear an acknowledgement
fw ack --clear @a7f3c
```
