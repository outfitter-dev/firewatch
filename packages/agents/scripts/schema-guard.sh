#!/bin/bash
# firewatch PreToolUse hook - validates jq field references against fw schema
#
# Intercepts Bash commands containing `fw` piped to `jq` and validates
# that field references (like .pr, .author) exist in the Firewatch schema.
# Blocks with helpful error + schema dump if unknown fields detected.

set -euo pipefail

# Read hook input from stdin
INPUT=$(cat)

# Extract tool name and command
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only process Bash tool calls
if [[ "$TOOL_NAME" != "Bash" ]]; then
  echo '{"decision": "allow"}'
  exit 0
fi

# Only process commands with fw piped to jq
if ! echo "$COMMAND" | grep -qE 'fw\s.*\|\s*jq'; then
  echo '{"decision": "allow"}'
  exit 0
fi

# Find fw binary
FW_BIN="${HOME}/.local/bin/fw"
if [[ ! -x "$FW_BIN" ]]; then
  FW_BIN="$(command -v fw 2>/dev/null || true)"
fi

# If fw not found, allow (can't validate)
if [[ -z "$FW_BIN" || ! -x "$FW_BIN" ]]; then
  echo '{"decision": "allow"}'
  exit 0
fi

# Get valid schema fields
SCHEMA=$("$FW_BIN" schema 2>/dev/null || true)
if [[ -z "$SCHEMA" ]]; then
  echo '{"decision": "allow"}'
  exit 0
fi

# Extract valid field names from schema
VALID_FIELDS=$(echo "$SCHEMA" | jq -r '.fields | keys[]' 2>/dev/null | sort -u)
if [[ -z "$VALID_FIELDS" ]]; then
  echo '{"decision": "allow"}'
  exit 0
fi

# Extract jq portion of command (after the pipe to jq)
JQ_PART=$(echo "$COMMAND" | sed -n "s/.*|[[:space:]]*jq[[:space:]]*//p")

# Extract field references from jq query (patterns like .field_name)
# Match .word patterns but exclude jq builtins and operators
FIELD_REFS=$(echo "$JQ_PART" | grep -oE '\.[a-z_][a-z_0-9]*' | sed 's/^\.//' | sort -u || true)

if [[ -z "$FIELD_REFS" ]]; then
  echo '{"decision": "allow"}'
  exit 0
fi

# Known jq builtins to ignore
JQ_BUILTINS="length|keys|values|type|empty|error|not|add|any|all|flatten|group_by|unique|unique_by|max|max_by|min|min_by|sort|sort_by|reverse|contains|inside|startswith|endswith|split|join|ascii|ascii_downcase|ascii_upcase|tonumber|tostring|tojson|fromjson|now|floor|ceil|round|sqrt|log|log2|log10|exp|exp2|exp10|isnan|isinfinite|nan|infinite|isnormal|first|last|nth|range|select|map|map_values|recurse|walk|env|transpose|bsearch|input|inputs|debug|stderr|path|paths|getpath|setpath|delpaths|leaf_paths|modulemeta|limit|until|while|repeat|gsub|sub|test|match|capture|scan|splits|null|true|false"

# Check each field reference
INVALID_FIELDS=""
for field in $FIELD_REFS; do
  # Skip jq builtins
  if echo "$field" | grep -qE "^($JQ_BUILTINS)$"; then
    continue
  fi

  # Check if field exists in schema
  if ! echo "$VALID_FIELDS" | grep -qx "$field"; then
    INVALID_FIELDS="$INVALID_FIELDS $field"
  fi
done

# Trim whitespace
INVALID_FIELDS=$(echo "$INVALID_FIELDS" | xargs)

if [[ -n "$INVALID_FIELDS" ]]; then
  # Format schema fields for display
  SCHEMA_DISPLAY=$("$FW_BIN" schema 2>/dev/null | jq -r '.fields | to_entries | .[] | "  .\(.key): \(.value.type // "unknown") - \(.value.description // "")"' 2>/dev/null || echo "$VALID_FIELDS")

  # Build error message
  ERROR_MSG="Invalid field reference(s) in jq query: $INVALID_FIELDS

Valid Firewatch schema fields:
$SCHEMA_DISPLAY

Hint: Use 'fw schema' to see full schema, or 'fw --limit 1' to see example output."

  # Return block decision with error
  jq -n --arg reason "$ERROR_MSG" '{"decision": "block", "reason": $reason}'
  exit 0
fi

# All fields valid
echo '{"decision": "allow"}'
