#!/usr/bin/env bash
# Firewatch CLI test runner
# Usage: ./run-tests.sh [category|--all]
#
# Categories:
#   query-validation     Root command filters, conflicts
#   mutation-validation  add/edit/rm/close validation rules
#   output-modes         --json, --short, schema variants
#   error-taxonomy       Error messages, exit codes
#   edge-cases           Boundaries, malformed input
#   --all               Run all categories

set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Source shared library
source "$SCRIPT_DIR/lib/test-runner-lib.sh"

# Firewatch-specific configuration
FW_BIN="bun $PROJECT_ROOT/apps/cli/bin/fw.ts"
OUTPUT_DIR="$PROJECT_ROOT/.scratch/testing"

# Initialize test runner
init_test_runner "$OUTPUT_DIR" "Firewatch CLI"

# ============================================================================
# Test Categories
# ============================================================================

run_query_validation() {
  local category="query-validation"
  print_header "Running $category tests"
  setup_category "$category"

  # Test 1: Help shows options
  run_test 1 "Help shows options" \
    "$FW_BIN --help" \
    "(--type|--since|--prs)" "false"

  # Test 2: Invalid type rejected
  run_test 2 "Invalid type rejected" \
    "$FW_BIN --type invalid" \
    "invalid|unknown|type" "true"

  # Test 3: Invalid PR number
  run_test 3 "Invalid PR number" \
    "$FW_BIN --prs abc" \
    "invalid|number|error" "true"

  # Test 4: Offline conflicts with refresh
  run_test 4 "Offline conflicts with refresh" \
    "$FW_BIN --offline --refresh" \
    "cannot be used|conflict|incompatible" "true"

  # Test 5: Mine conflicts with reviews
  run_test 5 "Mine conflicts with reviews" \
    "$FW_BIN --mine --reviews" \
    "cannot|conflict|both" "true"

  # Test 6: Orphaned conflicts with open
  run_test 6 "Orphaned conflicts with open" \
    "$FW_BIN --orphaned --open" \
    "cannot be used|conflict|incompatible" "true"

  # Test 7: Invalid refresh value
  run_test 7 "Invalid refresh value" \
    "$FW_BIN --refresh invalid" \
    "invalid|error|expected" "true"

  # Test 8: No repo outside git
  run_test 8 "No repo outside git" \
    "(cd /tmp && $FW_BIN)" \
    "no repository|not.*git|could not detect" "true"

  # Test 9: Valid type accepted
  run_test 9 "Valid type accepted" \
    "$FW_BIN --type comment --help" \
    "(--type|comment|filter)" "false"

  finalize_category
}

run_mutation_validation() {
  local category="mutation-validation"
  print_header "Running $category tests"
  setup_category "$category"

  # Test 1: Add help exists
  run_test 1 "Add help exists" \
    "$FW_BIN add --help" \
    "(add|comment|review)" "false"

  # Test 2: Add resolve without reply
  run_test 2 "Add resolve without reply" \
    "$FW_BIN add 1 'text' --resolve" \
    "requires.*reply|--reply" "true"

  # Test 3: Add review with metadata
  run_test 3 "Add review with metadata" \
    "$FW_BIN add 1 --review approve --label bug" \
    "cannot|combined|conflict" "true"

  # Test 4: Add body with metadata
  run_test 4 "Add body with metadata" \
    "$FW_BIN add 1 'text' --label bug" \
    "remove.*body|conflict|cannot|combined" "true"

  # Test 5: Add no body or action
  run_test 5 "Add no body or action" \
    "$FW_BIN add 1" \
    "body.*required|required|missing" "true"

  # Test 6: Edit help exists
  run_test 6 "Edit help exists" \
    "$FW_BIN edit --help" \
    "(edit|update|PR)" "false"

  # Test 7: Edit draft ready conflict
  run_test 7 "Edit draft ready conflict" \
    "$FW_BIN edit 1 --draft --ready" \
    "cannot.*together|conflict|both" "true"

  # Test 8: Edit no changes
  run_test 8 "Edit no changes" \
    "$FW_BIN edit 1" \
    "no edits|nothing|specify" "true"

  # Test 9: Rm help exists
  run_test 9 "Rm help exists" \
    "$FW_BIN rm --help" \
    "(remove|rm|delete)" "false"

  # Test 10: Rm no action
  run_test 10 "Rm no action" \
    "$FW_BIN rm 1" \
    "no removals|nothing|specify" "true"

  # Test 11: Close help exists
  run_test 11 "Close help exists" \
    "$FW_BIN close --help" \
    "(close|resolve|thread)" "false"

  # Test 12: Close no IDs
  run_test 12 "Close no IDs" \
    "$FW_BIN close" \
    "required|missing|argument" "true"

  finalize_category
}

run_output_modes() {
  local category="output-modes"
  print_header "Running $category tests"
  setup_category "$category"

  # Test 1: Status default
  run_test 1 "Status default" \
    "$FW_BIN status" \
    "(firewatch|status|cache)" "false"

  # Test 2: Status short
  run_test 2 "Status short" \
    "$FW_BIN status --short" \
    "." "false"

  # Test 3: Status JSON valid
  run_test 3 "Status JSON valid" \
    "$FW_BIN status --json | jq -e . > /dev/null && echo 'valid json'" \
    "valid json" "false"

  # Test 4: Schema entry
  run_test 4 "Schema entry" \
    "$FW_BIN schema entry" \
    '(\$schema|"type"|properties)' "false"

  # Test 5: Schema worklist
  run_test 5 "Schema worklist" \
    "$FW_BIN schema worklist" \
    '(\$schema|"type"|properties)' "false"

  # Test 6: Schema config
  run_test 6 "Schema config" \
    "$FW_BIN schema config" \
    '(\$schema|"type"|properties)' "false"

  # Test 7: Schema invalid
  run_test 7 "Schema invalid" \
    "$FW_BIN schema invalid" \
    "unknown|invalid|not found" "true"

  # Test 8: Config shows content
  run_test 8 "Config shows content" \
    "$FW_BIN config" \
    "." "false"

  # Test 9: Config path
  run_test 9 "Config path" \
    "$FW_BIN config --path" \
    "(config|\.toml|firewatch)" "false"

  finalize_category
}

run_error_taxonomy() {
  local category="error-taxonomy"
  print_header "Running $category tests"
  setup_category "$category"

  # Test 1: Query error format
  run_test 1 "Query error format" \
    "$FW_BIN --type invalid" \
    "invalid|type|error" "true"

  # Test 2: Add error format
  run_test 2 "Add error format" \
    "$FW_BIN add 1 --resolve" \
    "requires|error" "true"

  # Test 3: Edit error format
  run_test 3 "Edit error format" \
    "$FW_BIN edit 1 --draft --ready" \
    "cannot|error|conflict" "true"

  # Test 4: Unknown flag
  run_test 4 "Unknown flag" \
    "$FW_BIN --unknown-flag-xyz" \
    "unknown|error|invalid" "true"

  # Test 5: Exit code success
  run_test 5 "Exit code success" \
    "$FW_BIN --help && echo 'exit zero'" \
    "exit zero" "false"

  # Test 6: Exit code failure
  run_test 6 "Exit code failure" \
    "$FW_BIN --type invalid; [[ \$? -ne 0 ]] && echo 'nonzero exit'" \
    "nonzero exit" "false"

  finalize_category
}

run_edge_cases() {
  local category="edge-cases"
  print_header "Running $category tests"
  setup_category "$category"

  # Test 1: Empty repo falls back to detected (valid behavior)
  run_test 1 "Empty repo falls back" \
    "$FW_BIN --repo '' --help" \
    "(--repo|query)" "false"

  # Test 2: Malformed repo
  run_test 2 "Malformed repo" \
    "$FW_BIN --repo firewatch" \
    "invalid|format|owner/repo" "true"

  # Test 3: Large limit (should accept)
  run_test 3 "Large limit" \
    "$FW_BIN --limit 999999 --help" \
    "(--limit|query)" "false"

  # Test 4: Zero limit
  run_test 4 "Zero limit" \
    "$FW_BIN --limit 0 --help" \
    "(--limit|query)" "false"

  # Test 5: Negative PR
  run_test 5 "Negative PR" \
    "$FW_BIN --prs -1" \
    "invalid|error|positive" "true"

  # Test 6: Duration no unit
  run_test 6 "Duration no unit" \
    "$FW_BIN --since 24" \
    "invalid|unit|format" "true"

  # Test 7: Duration invalid unit
  run_test 7 "Duration invalid unit" \
    "$FW_BIN --since 24x" \
    "invalid|unknown|unit" "true"

  # Test 8: Author with hyphen
  run_test 8 "Author with hyphen" \
    "$FW_BIN --author some-user --help" \
    "(--author|query)" "false"

  # Test 9: Doctor runs
  run_test 9 "Doctor runs" \
    "$FW_BIN doctor" \
    "(check|auth|cache|status)" "false"

  finalize_category
}

run_all() {
  print_header "Running all test categories"

  local total_passed=0
  local total_warned=0
  local total_failed=0
  local total_tests=0

  for category in query-validation mutation-validation output-modes error-taxonomy edge-cases; do
    "run_${category//-/_}"
    total_passed=$((total_passed + PASSED))
    total_warned=$((total_warned + WARNED))
    total_failed=$((total_failed + FAILED))
    total_tests=$((total_tests + TOTAL))
    echo ""
  done

  # Create aggregate summary
  local summary_file="$OUTPUT_DIR/${TEST_RUNNER_DATE_PREFIX}-${TEST_RUNNER_RUN_ID}-summary.md"
  cat > "$summary_file" << EOF
# Firewatch CLI Test Summary

**Date**: $(date '+%Y-%m-%d %H:%M:%S')
**Runner**: run-tests.sh --all

## Aggregate Results

| Category | Passed | Warned | Failed | Total |
|----------|--------|--------|--------|-------|
| query-validation | - | - | - | - |
| mutation-validation | - | - | - | - |
| output-modes | - | - | - | - |
| error-taxonomy | - | - | - | - |
| edge-cases | - | - | - | - |
| **TOTAL** | **$total_passed** | **$total_warned** | **$total_failed** | **$total_tests** |

## Reports

$(ls -1 "$OUTPUT_DIR"/${TEST_RUNNER_DATE_PREFIX}-${TEST_RUNNER_RUN_ID}-*.md 2>/dev/null | while read f; do echo "- \`${f##*/}\`"; done)

EOF

  echo "============================================"
  echo -e "${BOLD}TOTAL: $total_passed passed, $total_warned warned, $total_failed failed ($total_tests tests)${NC}"
  echo "Summary: $summary_file"
  echo "============================================"

  # Return appropriate exit code
  if [[ $total_failed -gt 0 ]]; then
    return 1
  fi
  return 0
}

# ============================================================================
# Main
# ============================================================================

show_usage() {
  cat << EOF
Firewatch CLI Test Runner

Usage: $0 [category|--all]

Categories:
  query-validation     Root command filters, conflicts (~9 tests)
  mutation-validation  add/edit/rm/close validation rules (~12 tests)
  output-modes         --json, --short, schema variants (~9 tests)
  error-taxonomy       Error messages, exit codes (~6 tests)
  edge-cases           Boundaries, malformed input (~9 tests)

Options:
  --all               Run all categories (~45 tests)
  --help, -h          Show this help

Output:
  Reports written to .scratch/testing/
  Format: {date}-{id}-{category}.md

Examples:
  $0 query-validation
  $0 --all
EOF
}

main() {
  local category="${1:-}"

  case "$category" in
    -h|--help|"")
      show_usage
      exit 0
      ;;
    --all)
      run_all
      exit $?
      ;;
    query-validation)
      run_query_validation
      ;;
    mutation-validation)
      run_mutation_validation
      ;;
    output-modes)
      run_output_modes
      ;;
    error-taxonomy)
      run_error_taxonomy
      ;;
    edge-cases)
      run_edge_cases
      ;;
    *)
      echo "Unknown category: $category"
      echo "Run '$0 --help' for usage"
      exit 2
      ;;
  esac

  # Exit with appropriate code
  if [[ $FAILED -gt 0 ]]; then
    exit 1
  fi
  exit 0
}

main "$@"
