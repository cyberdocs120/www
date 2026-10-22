#!/usr/bin/env bash
# Tests for the "Ensure handoff artifacts are not tracked" CI gate.
#
# Strategy: initialise a throw-away git repo in a temp directory, stage one
# artifact at a time, run the gate logic, and assert it exits non-zero.
# Then verify that the matching lowercase / hyphen / underscore variants that
# were historically missing also trigger the gate.

set -euo pipefail

PASS=0
FAIL=0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Colours (suppressed when not a TTY)
if [ -t 1 ]; then
  GREEN='\033[0;32m'; RED='\033[0;31m'; RESET='\033[0m'
else
  GREEN=''; RED=''; RESET=''
fi

ok()   { echo -e "${GREEN}  PASS${RESET}  $1"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}  FAIL${RESET}  $1"; FAIL=$((FAIL+1)); }

# Run the gate logic against a git repo that has $1 tracked.
# Returns the gate's exit code (0 = clean, 1 = blocked).
run_gate_with_file() {
  local file="$1"
  local tmpdir
  tmpdir=$(mktemp -d)
  # shellcheck disable=SC2064
  trap "rm -rf '$tmpdir'" RETURN

  git -C "$tmpdir" init -q
  git -C "$tmpdir" config user.email "test@example.com"
  git -C "$tmpdir" config user.name "Test"

  # Create parent dirs if the path contains a slash (subdirectory variant)
  mkdir -p "$tmpdir/$(dirname "$file")"
  echo "stub" > "$tmpdir/$file"
  git -C "$tmpdir" add "$file"

  # Replicate the exact gate logic from ci.yml
  (
    cd "$tmpdir"
    patterns=(
      'HANDOFF.md'
      'HANDOFF_*.md'
      'handoff.md'
      'handoff_*.md'
      'PR_INFO.md'
      'PR_DESCRIPTION.md'
      'PR_BODY.md'
      'pr-info.md'
      'pr_info.md'
      'pr-description.md'
      'pr_description.md'
      'pr-body.md'
      'pr_body.md'
    )
    found=0
    for p in "${patterns[@]}"; do
      matches=$(git ls-files "$p" 2>/dev/null)
      if [ -n "$matches" ]; then
        found=1
      fi
    done
    exit "$found"
  )
  return $?
}

# Assert that staging $1 causes the gate to block (exit 1).
assert_blocked() {
  local file="$1"
  if run_gate_with_file "$file"; then
    fail "gate should block '$file' but it passed"
  else
    ok "gate blocks '$file'"
  fi
}

# Assert that staging $1 does NOT trigger the gate (exit 0).
assert_allowed() {
  local file="$1"
  if run_gate_with_file "$file"; then
    ok "gate allows '$file'"
  else
    fail "gate should allow '$file' but it blocked"
  fi
}

# ---------------------------------------------------------------------------
# HANDOFF family
# ---------------------------------------------------------------------------
echo
echo "--- HANDOFF family ---"
assert_blocked "HANDOFF.md"
assert_blocked "HANDOFF_v2.md"
assert_blocked "HANDOFF_final.md"
assert_blocked "handoff.md"
assert_blocked "handoff_v2.md"
assert_blocked "handoff_final.md"

# ---------------------------------------------------------------------------
# PR_INFO / pr-info / pr_info family
# ---------------------------------------------------------------------------
echo
echo "--- PR_INFO family ---"
assert_blocked "PR_INFO.md"
assert_blocked "pr-info.md"
assert_blocked "pr_info.md"

# ---------------------------------------------------------------------------
# PR_DESCRIPTION / pr-description / pr_description family
# ---------------------------------------------------------------------------
echo
echo "--- PR_DESCRIPTION family ---"
assert_blocked "PR_DESCRIPTION.md"
assert_blocked "pr-description.md"
assert_blocked "pr_description.md"

# ---------------------------------------------------------------------------
# PR_BODY / pr-body / pr_body family
# ---------------------------------------------------------------------------
echo
echo "--- PR_BODY family ---"
assert_blocked "PR_BODY.md"
assert_blocked "pr-body.md"
assert_blocked "pr_body.md"

# ---------------------------------------------------------------------------
# Negative cases — files that must NOT be blocked
# ---------------------------------------------------------------------------
echo
echo "--- Negative cases (should pass the gate) ---"
assert_allowed "README.md"
assert_allowed "docs/CONTRIBUTING.md"
assert_allowed "CHANGELOG.md"
assert_allowed "src/handoff-utils.ts"   # not a .md at root
assert_allowed "notes/handoff-notes.txt" # wrong extension

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo
echo "Results: ${PASS} passed, ${FAIL} failed"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
