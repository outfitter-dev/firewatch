#!/usr/bin/env bash
# test-runner-lib.sh - Shared CLI test runner library for Outfitter projects
#
# tldr ::: Shared bash library for CLI integration testing with markdown reporting
#
# Usage:
#   source "$(dirname "$0")/lib/test-runner-lib.sh"
#   init_test_runner ".scratch/testing"
#   setup_category "my-tests"
#   run_test 1 "Test name" "command" "expected_pattern" "false"
#   finalize_category
#
# Provides:
#   - TTY-aware color output
#   - Markdown report generation
#   - Debug log capture
#   - Consistent PASS/WARN/FAIL classification
#
# Counter variables (exported):
#   PASSED, WARNED, FAILED, TOTAL
#
# Output files (set by setup_category):
#   RESULTS_FILE, DEBUG_FILE

# ============================================================================
# Guard against multiple sourcing
# ============================================================================

if [[ -n "${_TEST_RUNNER_LIB_LOADED:-}" ]]; then
  return 0
fi
_TEST_RUNNER_LIB_LOADED=1

# ============================================================================
# Configuration (set by init_test_runner)
# ============================================================================

# Output directory for test results
TEST_RUNNER_OUTPUT_DIR=""

# Date/run identifiers
TEST_RUNNER_DATE_PREFIX=""
TEST_RUNNER_RUN_ID=""

# Project name (used in report headers)
TEST_RUNNER_PROJECT_NAME="CLI"

# ============================================================================
# Color definitions (set by init_test_runner based on TTY)
# ============================================================================

# Color codes - initialized empty, set by init_test_runner
RED=""
GREEN=""
YELLOW=""
BLUE=""
BOLD=""
NC=""

# ============================================================================
# Test counters (global for simplicity)
# ============================================================================

PASSED=0
WARNED=0
FAILED=0
TOTAL=0

# ============================================================================
# Output files (set by setup_category)
# ============================================================================

RESULTS_FILE=""
DEBUG_FILE=""

# ============================================================================
# Core Functions
# ============================================================================

# init_test_runner [output_dir] [project_name]
#
# Initialize the test runner with output directory and optional project name.
# Must be called before any other functions.
#
# Arguments:
#   output_dir   - Directory for test reports (default: .scratch/testing)
#   project_name - Name shown in report headers (default: CLI)
#
# Side effects:
#   - Sets color codes based on TTY detection
#   - Sets date prefix and run ID
#   - Creates output directory
#
init_test_runner() {
  local output_dir="${1:-.scratch/testing}"
  local project_name="${2:-CLI}"

  TEST_RUNNER_OUTPUT_DIR="$output_dir"
  TEST_RUNNER_PROJECT_NAME="$project_name"
  TEST_RUNNER_DATE_PREFIX="$(date +%Y%m%d)"
  TEST_RUNNER_RUN_ID="$(date +%H%M%S)"

  # Set colors based on TTY detection
  if [[ -t 1 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    BLUE='\033[0;34m'
    BOLD='\033[1m'
    NC='\033[0m'
  else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    BOLD=''
    NC=''
  fi

  # Create output directory
  mkdir -p "$TEST_RUNNER_OUTPUT_DIR"
}

# setup_category NAME
#
# Set up output files for a test category.
# Creates markdown report and debug log files.
#
# Arguments:
#   NAME - Category name (used in filenames and headers)
#
# Side effects:
#   - Creates RESULTS_FILE and DEBUG_FILE
#   - Resets counters
#
# Example:
#   setup_category "edge-cases"
#
setup_category() {
  local category="$1"

  # Validate initialization
  if [[ -z "$TEST_RUNNER_OUTPUT_DIR" ]]; then
    echo "ERROR: init_test_runner must be called before setup_category" >&2
    return 1
  fi

  # Reset counters for new category
  reset_counters

  # Set output file paths
  RESULTS_FILE="$TEST_RUNNER_OUTPUT_DIR/${TEST_RUNNER_DATE_PREFIX}-${TEST_RUNNER_RUN_ID}-${category}.md"
  DEBUG_FILE="$TEST_RUNNER_OUTPUT_DIR/${TEST_RUNNER_DATE_PREFIX}-${TEST_RUNNER_RUN_ID}-${category}-debug.log"

  # Initialize markdown report
  cat > "$RESULTS_FILE" << EOF
# ${TEST_RUNNER_PROJECT_NAME} Test Report

**Category**: ${category}
**Run ID**: ${TEST_RUNNER_RUN_ID}
**Date**: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
**Debug Log**: ${DEBUG_FILE##*/}

---

## Results

| # | Test | Status | Details |
|---|------|--------|---------|
EOF

  # Initialize debug log
  cat > "$DEBUG_FILE" << EOF
# ${TEST_RUNNER_PROJECT_NAME} Debug Log
# Category: ${category}
# Run ID: ${TEST_RUNNER_RUN_ID}
# Started: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# ============================================================

EOF
}

# run_test NUM NAME CMD PATTERN [EXPECT_FAIL]
#
# Execute a single test case and record results.
#
# Arguments:
#   NUM         - Test number (for ordering/display)
#   NAME        - Human-readable test name
#   CMD         - Command to execute (supports pipes, redirects via eval)
#   PATTERN     - Regex pattern to match in output
#   EXPECT_FAIL - "true" if command should fail, "false" otherwise (default: "false")
#
# Classification logic:
#   - PASS: Command behaved as expected AND output matched pattern
#   - WARN: Command behaved as expected BUT output didn't match pattern
#   - FAIL: Command behaved opposite to expectation
#
# Example:
#   run_test 1 "Help displays usage" "mycli --help" "Usage|usage" "false"
#   run_test 2 "Invalid flag fails" "mycli --invalid" "unknown|error" "true"
#
run_test() {
  local num="$1"
  local name="$2"
  local cmd="$3"
  local pattern="$4"
  local expect_fail="${5:-false}"

  # Increment total
  TOTAL=$((TOTAL + 1))

  # Console output (test start)
  echo -e "${BLUE}Test $num: $name${NC}"

  # Log to debug file
  cat >> "$DEBUG_FILE" << EOF

# Test $num: $name
# Command: $cmd
# Expected pattern: $pattern
# Expect fail: $expect_fail
---
EOF

  # Execute command and capture output/exit code
  local output=""
  local exit_code=0

  # Use eval to handle complex commands with pipes/redirects
  # Temporarily disable errexit to capture exit code
  set +e
  output=$(eval "$cmd" 2>&1)
  exit_code=$?
  set -e

  # Log output to debug file
  echo "$output" >> "$DEBUG_FILE"
  echo "Exit code: $exit_code" >> "$DEBUG_FILE"
  echo "---" >> "$DEBUG_FILE"

  # Evaluate result
  local status="FAIL"
  local details=""

  if [[ "$expect_fail" == "true" ]]; then
    # Expecting failure (non-zero exit code)
    if [[ $exit_code -ne 0 ]]; then
      # Command failed as expected - check pattern
      if echo "$output" | grep -qE "$pattern"; then
        status="PASS"
        details="Got expected error pattern"
      else
        status="WARN"
        details="Failed but pattern not matched"
      fi
    else
      # Command succeeded when it should have failed
      status="FAIL"
      details="Expected failure but got exit code 0"
    fi
  else
    # Expecting success (zero exit code)
    if [[ $exit_code -eq 0 ]]; then
      # Command succeeded as expected - check pattern
      if echo "$output" | grep -qE "$pattern"; then
        status="PASS"
        details="Output matched expected pattern"
      else
        status="WARN"
        details="Succeeded but pattern not matched"
      fi
    else
      # Command failed when it should have succeeded
      status="FAIL"
      details="Expected success, got exit code $exit_code"
    fi
  fi

  # Update counters
  case "$status" in
    PASS)
      PASSED=$((PASSED + 1))
      echo -e "  ${GREEN}PASS${NC}: $details"
      ;;
    WARN)
      WARNED=$((WARNED + 1))
      echo -e "  ${YELLOW}WARN${NC}: $details"
      ;;
    FAIL)
      FAILED=$((FAILED + 1))
      echo -e "  ${RED}FAIL${NC}: $details"
      ;;
  esac

  # Write to markdown report
  echo "| $num | $name | $status | $details |" >> "$RESULTS_FILE"
}

# finalize_category
#
# Finalize the current test category by writing summary to report.
# Returns 0 if no failures, 1 if any failures.
#
# Side effects:
#   - Appends summary table to RESULTS_FILE
#   - Prints summary to console
#
# Returns:
#   0 - All tests passed (possibly with warnings)
#   1 - One or more tests failed
#
finalize_category() {
  # Add summary to markdown report
  cat >> "$RESULTS_FILE" << EOF

---

## Summary

| Metric | Count |
|--------|-------|
| Total | $TOTAL |
| Passed | $PASSED |
| Warnings | $WARNED |
| Failed | $FAILED |

EOF

  # Add debug log reference if there were failures
  if [[ $FAILED -gt 0 ]]; then
    cat >> "$RESULTS_FILE" << EOF
### Debug Information

See debug log for details: \`${DEBUG_FILE##*/}\`
EOF
  fi

  # Close debug log
  cat >> "$DEBUG_FILE" << EOF

# ============================================================
# Completed: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Results: $PASSED passed, $WARNED warnings, $FAILED failed (of $TOTAL)
# ============================================================
EOF

  # Print summary to console
  echo ""
  echo -e "${BOLD}=== Summary ===${NC}"
  echo -e "Total:    $TOTAL"
  echo -e "Passed:   ${GREEN}$PASSED${NC}"
  echo -e "Warnings: ${YELLOW}$WARNED${NC}"
  echo -e "Failed:   ${RED}$FAILED${NC}"
  echo ""
  echo "Results: $RESULTS_FILE"
  echo "Debug:   $DEBUG_FILE"

  # Return appropriate exit code
  if [[ $FAILED -gt 0 ]]; then
    return 1
  fi
  return 0
}

# log MSG
#
# Log a message to the debug file with timestamp.
#
# Arguments:
#   MSG - Message to log
#
# Example:
#   log "Setting up test fixtures"
#
log() {
  local msg="$*"
  echo "[$(date +%H:%M:%S)] $msg" >> "$DEBUG_FILE"
}

# reset_counters
#
# Reset all test counters to zero.
# Called automatically by setup_category, but can be called manually.
#
reset_counters() {
  PASSED=0
  WARNED=0
  FAILED=0
  TOTAL=0
}

# ============================================================================
# Utility Functions
# ============================================================================

# print_header MSG
#
# Print a section header to console.
#
# Arguments:
#   MSG - Header text
#
print_header() {
  local msg="$1"
  echo ""
  echo -e "${BOLD}=== $msg ===${NC}"
  echo ""
}

# print_pass MSG
#
# Print a pass message to console.
#
print_pass() {
  echo -e "${GREEN}PASS${NC} $*"
}

# print_warn MSG
#
# Print a warning message to console.
#
print_warn() {
  echo -e "${YELLOW}WARN${NC} $*"
}

# print_fail MSG
#
# Print a failure message to console.
#
print_fail() {
  echo -e "${RED}FAIL${NC} $*"
}

# print_info MSG
#
# Print an info message to console.
#
print_info() {
  echo -e "${BLUE}[test]${NC} $*"
}

# get_results_file
#
# Get the path to the current results file.
# Useful for custom test logic that needs to append to the report.
#
get_results_file() {
  echo "$RESULTS_FILE"
}

# get_debug_file
#
# Get the path to the current debug file.
# Useful for custom test logic that needs to log additional info.
#
get_debug_file() {
  echo "$DEBUG_FILE"
}

# ============================================================================
# Advanced: Custom test result recording
# ============================================================================

# record_custom_result NUM NAME STATUS DETAILS
#
# Record a custom test result without running a command.
# Useful for tests that need custom evaluation logic.
#
# Arguments:
#   NUM     - Test number
#   NAME    - Test name
#   STATUS  - "PASS", "WARN", or "FAIL"
#   DETAILS - Description of result
#
# Example:
#   # Custom JSON validation test
#   output=$(mycli output --json)
#   if echo "$output" | jq -e . >/dev/null 2>&1; then
#     record_custom_result 5 "JSON is valid" "PASS" "Output parsed as valid JSON"
#   else
#     record_custom_result 5 "JSON is valid" "FAIL" "Output is not valid JSON"
#   fi
#
record_custom_result() {
  local num="$1"
  local name="$2"
  local status="$3"
  local details="$4"

  TOTAL=$((TOTAL + 1))

  # Update counters
  case "$status" in
    PASS)
      PASSED=$((PASSED + 1))
      echo -e "${GREEN}PASS${NC} $num. $name"
      ;;
    WARN)
      WARNED=$((WARNED + 1))
      echo -e "${YELLOW}WARN${NC} $num. $name - $details"
      ;;
    FAIL)
      FAILED=$((FAILED + 1))
      echo -e "${RED}FAIL${NC} $num. $name - $details"
      ;;
  esac

  # Write to markdown report
  echo "| $num | $name | $status | $details |" >> "$RESULTS_FILE"

  # Log to debug file
  cat >> "$DEBUG_FILE" << EOF

# Test $num: $name (custom)
# Status: $status
# Details: $details
---
EOF
}

# ============================================================================
# Export variables for subshells
# ============================================================================

export PASSED WARNED FAILED TOTAL
export RESULTS_FILE DEBUG_FILE
export RED GREEN YELLOW BLUE BOLD NC
