# fw doctor

Diagnose setup issues (auth, cache, repo detection, GitHub API reachability, Graphite).

## Synopsis

```bash
fw doctor [options]
```

## Options

| Option      | Description                         |
| ----------- | ----------------------------------- |
| `--json`    | Force JSON output                   |
| `--no-json` | Force human-readable output         |
| `--fix`     | Attempt to fix issues automatically |

## Example Output

```
Checking firewatch health...

OK  GitHub API reachable
OK  Auth valid (galligan via gh)
OK  Config loaded (.firewatch.toml)
OK  Cache directory writable
OK  Repository detected (outfitter-dev/firewatch)
OK  Graphite CLI available

All systems operational
```
