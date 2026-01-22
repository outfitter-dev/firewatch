# fw schema

Output JSON schemas for Firewatch data types.

## Synopsis

```bash
fw schema
fw schema <name>
```

## Options

| Option | Description                                         |
| ------ | --------------------------------------------------- |
| `name` | Schema to display: `entry`, `worklist`, or `config` |

## Examples

```bash
# List available schemas
fw schema

# Output entry schema
fw schema entry

# Output worklist schema
fw schema worklist

# Output config schema
fw schema config
```

## Use Cases

- **Entry schema**: structure of individual activity records from `fw`
- **Worklist schema**: structure of aggregated per-PR summaries (`fw --summary`)
- **Config schema**: configuration file format
