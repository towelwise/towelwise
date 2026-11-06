#!/usr/bin/env bash
# Self-check for typecheck-errors.sh: a fake npm stands in for the typecheck, so this runs in a second.
set -uo pipefail
helper="$(dirname "$0")/typecheck-errors.sh"
failed=0

# check <name> <expected helper exit> <fake typecheck output> <fake typecheck exit>
check() {
  FAKE_OUT="$3" FAKE_CODE="$4" bash "${helper}" > /dev/null 2>&1
  local got=$?
  if [[ ${got} -ne $2 ]]; then echo "FAIL: $1 (helper exited ${got}, expected $2)"; failed=1; fi
}
npm() { printf '%s\n' "${FAKE_OUT}"; return "${FAKE_CODE}"; }
export -f npm

error='src/a.ts(1,2): error TS2322: Type x is not assignable to type y.'
check 'clean typecheck' 0 '' 0
check 'type errors reported' 0 "${error}" 1
check 'type errors reported, status 2' 0 "${error}" 2
check 'failure without type errors' 1 'boom' 1
check 'killed after reporting type errors' 1 "${error}"$'\nKilled' 137
check 'out of memory after reporting type errors' 1 "${error}" 134

line=$(FAKE_OUT="${error}" FAKE_CODE=1 bash "${helper}")
[[ "${line}" == 'src/a.ts: error TS2322: Type x is not assignable to type y.' ]] || { echo "FAIL: line numbers not removed: ${line}"; failed=1; }

[[ ${failed} -eq 0 ]] && echo 'typecheck-errors.sh: all checks pass'
exit "${failed}"
