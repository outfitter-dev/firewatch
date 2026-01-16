# fw status

Show Firewatch state information (auth, config, repo detection, cache stats, Graphite availability).

## Synopsis

```bash
fw status [options]
```

## Options

| Option      | Description                 |
| ----------- | --------------------------- |
| `--short`   | Compact single-line output  |
| `--json`    | Force JSON output           |
| `--no-json` | Force human-readable output |

## Example Output (Human)

```
Firewatch v1.2.0

Auth:      galligan (via gh)
Config:    .firewatch.toml (project) + ~/.config/firewatch/config.toml (user)
Repo:      outfitter-dev/firewatch (git)
Graphite:  enabled

Cache:
  Repos:     3
  Entries:   247
  Last sync: 2 minutes ago
  Size:      1.2 MB
```

## Example Output (JSON)

```json
{
  "version": "1.2.0",
  "auth": { "ok": true, "source": "gh", "username": "galligan" },
  "config": {
    "user": {
      "path": "/Users/mg/.config/firewatch/config.toml",
      "exists": true
    },
    "project": {
      "path": "/Users/mg/Developer/outfitter/firewatch/.firewatch.toml",
      "exists": true
    }
  },
  "repo": { "name": "outfitter-dev/firewatch", "source": "git" },
  "graphite": { "available": true },
  "cache": {
    "repos": 3,
    "entries": 247,
    "size_bytes": 1234567,
    "last_sync": "2026-01-14T18:10:00Z"
  }
}
```
