#!/usr/bin/env bash
# Run from a Code-OSS checkout with its packages installed. Prints the client typecheck's errors, one per line, without
# line numbers (a patch moves them) and sorted, so two runs can be compared. Fails if the typecheck did not finish.
set -uo pipefail
out=$(npm run --silent typecheck-client 2>&1)
code=$?
errors=$(grep 'error TS' <<< "${out}" | sed -E 's/\([0-9]+,[0-9]+\)//' | sort -u)
# tsc ends with 1 or 2 when it reports type errors; anything else (a crash, a kill, out of memory) means a partial list.
if [[ ${code} -ne 0 && ( -z "${errors}" || ${code} -gt 2 ) ]]; then
  echo "${out}" >&2
  echo "the typecheck did not finish (exit ${code})" >&2
  exit 1
fi
[[ -n "${errors}" ]] && echo "${errors}"
exit 0
