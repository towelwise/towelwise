# Handoff to Claude Code

Date: 2026-10-29. Updated by Codex after reviewing commit `f929351`.

## Task and current status

**Update (Claude Code, 2026-10-29, after PR #5 was opened):** the user asked for true full screen while testing the installed build and approved an opt-in setting. Working tree, uncommitted: new `towelwise.hyperspace.fullScreen` (default false); the jump runs `workbench.action.toggleFullScreen` and records `fullScreen` in the snapshot, which changes shape from an array to `{ settings, fullScreen }` (an old-shape file is cleared as unreadable); restore removes the snapshot, then toggles back only if the jump did. VS Code exposes no way to read full-screen state, so jumping while already full screen inverts the window mode. One new test toggles real full screen in the test window; lint, build, test (11 passing) and package exit 0. Review focus: the snapshot shape change, the order (snapshot published before the toggle, so a failed toggle leaves restore toggling a window that never entered full screen), and that a failure after the file is cleared cannot leave hyperspace stuck.

**Update (Claude Code, 2026-10-29):** both `f929351` findings are addressed in the working tree, uncommitted. (1) `lockIsLive()` now treats only a missing file (`ENOENT`) or corrupt content as dead; any other read error aborts acquisition and leaves the other owner's lock in place. (2) `acquire()` removes its own marker if the scan or any later step throws. One regression test plants a directory named like a lock (a real non-`ENOENT` read error); it failed before the fix (leaked marker) and passes now. Lint, build, test (10 passing) and package exit 0. The PID-reuse and `hyperspace.tmp.*` limits are unchanged and still accepted.

Codex reviewed `f929351`, which replaces the shared time-based lock with uniquely named PID-owner files, published by rename. Each entrant creates its own marker and backs off if another live marker exists. Startup Restore now reports busy instead of silently succeeding. The earlier `ab59877` findings are addressed in ordinary operation; two filesystem-error paths remain, detailed below. No source changes were made by Codex.

Lint, build, all nine extension tests, and packaging passed. A four-process stress check found no overlapping critical sections in 1,000 attempts. Fault injection confirmed both remaining findings. These checks do not establish live VS Code multi-window/crash behavior.

Claude's next assignment: add targeted regressions for the two error paths, preserve other owners' locks on unexpected read errors, and clean up the entrant's marker if acquisition throws. Keep the current approved scope and avoid introducing a new locking architecture without user agreement.

Preserve the approved scope: settings restore exactly; closed side areas stay closed; the editor area is always kept; workspace overrides hide the rest and produce a message; hyperspace is shared across windows. Commands arriving during an active transition are ignored, but restore after a crash must still work. Reload recovery remains an approved manual check. The spec remains `ready-for-agent`.

## References

- Instructions: [AGENTS.md](../AGENTS.md) and [CLAUDE.md](../CLAUDE.md).
- Roadmap: [ROADMAP.md](../ROADMAP.md), Phase 2 slice 1. Hyperspace-first order and removal of agent buttons are committed.
- Active spec: [phase-2-hyperspace.md](specs/phase-2-hyperspace.md). Terms: [GLOSSARY.md](../GLOSSARY.md).
- Previous spec: [phase-1-bootstrap.md](specs/phase-1-bootstrap.md).
- Decisions: `docs/decisions/` does not exist yet; approved choices are recorded in the spec. Do not create a decision record without an actual approved trade-off.
- Prior evidence: [TRIAL.md](TRIAL.md); older bootstrap findings and pending checks there are historical.
- Current review findings: [this handoff](#review-findings). The commit review was originally delivered in chat; no separate findings file or saved reproduction script exists.

## Git state

- Branch: `feat/hyperspace`.
- Reviewed commit and current HEAD: `f9293517a3b1e739bd7e02474fe2764537ccb875` (`fix: replace time-based hyperspace lock with per-owner pid locks`), on top of `ab59877`. Review range: `f929351^..f929351`.
- Working tree was clean before and after review, and before this handoff update. This handoff is the only intended uncommitted change.
- The user reports nothing is pushed; Codex did not push or independently compare remote state.
- Earlier handoff branch/baseline and untracked-spec claims are obsolete.

## Review findings

Scope: the requested fix commit and its connected jump/restore callers, current spec, and tests. The whole-feature range `75a1920..f929351` was not independently re-reviewed in full. Unrelated local changes were excluded; none were present.

1. **P2 - A read error can remove another window's live lock** ([hyperspace.ts](../packages/towelwise/src/hyperspace.ts), lines 45-50 and 70-71). `lockIsLive()` converts every read failure to false, so acquisition deletes the marker even when its owner is alive. Injecting one `EIO` read error on a valid live marker caused that marker to be deleted and a new acquisition to succeed. This can admit simultaneous transitions. Abort acquisition on unexpected read errors and preserve the other marker until owner death is confirmed. Distinguish a disappeared file from a read failure.
2. **P2 - A failed directory scan leaks the entrant's live marker** ([hyperspace.ts](../packages/towelwise/src/hyperspace.ts), lines 64-67 and 82-87). `acquire()` publishes its marker before scanning, but the cleanup in `withLock()` starts only after acquisition returns. If scanning throws, the marker remains; its PID is alive and subsequent commands back off until the process exits or the marker reaches one hour. Injecting one scan error reproduced this despite the next scan succeeding. Clean up the entrant's marker on acquisition errors, while retaining it for a successful transition.

Fault reproductions: an inline `node -` script loaded freshly compiled `out/hyperspace.js` into a VM, appending an in-memory export of the existing `acquire` function. It used an in-memory filesystem and the real current PID. For finding 1, seed a fresh valid other-owner marker, throw `EIO` when that marker is read, and assert acquisition is granted and the marker deleted. For finding 2, throw once from `readdirSync` after publishing the own marker; assert acquisition throws, one live marker remains, and the next acquisition returns undefined. No source files or real user settings changed. No reproduction script was saved.

## Lock safety and known limits

With successful filesystem operations and transitions within the documented age limit, no ordinary create/scan race was found: a successful entrant keeps its marker until completion, so a later entrant sees it and backs off. Two simultaneous entrants may both back off; the user retries. The actual-process check used four Node workers, 250 attempts each, the compiled acquisition function, and an exclusive guard file to detect overlapping critical sections: 76 acquired, 924 busy, zero overlaps. It also seeded a dead-owner marker. Temporary stress-test files were removed; no test source was added.

- PID reuse can make an abandoned marker appear live until the unrelated process exits or the marker reaches one hour. [Node's process API](https://nodejs.org/api/process.html#processkillpid-signal) checks process existence, not creation identity.
- Crashes between writing and renaming a lock leave small ignored `hyperspace.tmp.*` files. They accumulate and lengthen scans, but do not grant competing locks. Cleanup is currently absent.
- The one-hour expiry also assumes no live transition lasts that long, as the `shortcut:` comment states. These are recorded limits, not extra blocking findings at expected local usage.

## Verification actually run for this commit

Commands ran from the repo root on Windows, Node 24.18.0 / npm 11.16.0.

| Command | Exit | Result |
| --- | --- | --- |
| `npm.cmd run lint` | 0 | ESLint passed. |
| `npm.cmd run build` | 0 | TypeScript compiled. |
| `npm.cmd test` outside sandbox | 0 | All nine tests passed on VS Code 1.144.0, including dead-owner recovery, competing toggles, and live-owner busy reporting. |
| `npm.cmd run package` | 0 | Produced `packages/towelwise/towelwise.vsix`, six entries including compiled extension and hyperspace modules. |
| Inline `node -` four-process stress check | 0 | 1,000 acquisition attempts; 76 acquired, 924 busy, zero overlapping critical sections. |
| Inline `node -` fault injection | 0 | Assertions confirmed both filesystem-error findings above. |
| `git diff --check` / `git status --short` | 0 | No whitespace errors; clean tree after review. |

Use `npm.cmd` in this PowerShell environment: the earlier bootstrap review found `npm.ps1` blocked by execution policy. That review also found the sandbox blocks Electron startup; the current extension tests ran outside it. Do not confuse those earlier environment failures with current test failures.

Codex did not rerun a clean `npm ci`. Claude's earlier successful install and checks are reported separately in TRIAL.md; they are not fresh Codex verification.

## Pending work and next action

Smallest next action: reproduce one unexpected other-marker read failure in a targeted regression, then fix it together with cleanup when acquisition throws. Run the targeted regressions and required lint/build/test/package checks. Preserve the documented PID-reuse/temporary-file limits unless the user requests a scope change. Keep fixes uncommitted for independent review unless the user requests a commit. This handoff does not authorize pushing, publishing, or editor installation.

- Current `ROADMAP.md` marks Phase 1 done except `docs/decisions/`. Earlier handoff entries describing bootstrap CI/manual VSIX checks as pending are historical; this review did not independently verify their later completion.
- Actual two-window operation, reload/crash recovery, optional area controls, manual VSIX installation for this feature, Linux/headless CI, macOS menu-bar behavior, and compatibility at VS Code 1.90 remain unchecked by Codex. Reload recovery is an approved manual check.
- Open VSX verification was pending in the bootstrap spec; its current status was not rechecked. Claude starter-skill discovery/execution evidence was also unestablished in the older trial record; do not claim completion from file existence.
- Bootstrap defaults (package path, VS Code floor, CI Node/runner, and packaging approach) were flagged in the previous review, with no user approval captured in this conversation.
- Keybinding (`ctrl+alt+h`), exact settings/commands, and saved-state storage are implementation defaults flagged by the active spec; no approval beyond that spec was established in this review.
- TRIAL.md, the spec, and application code were left unchanged. Current review evidence is recorded here.

Suggested skills: `grill-with-docs` for unresolved next-slice choices, `to-spec` before substantial implementation, `diagnosing-bugs` if a real check fails, `code-review` for the next independent review, and `handoff` when transferring work. Discover them in the receiving host; do not assume availability. Use `tdd` for agreed behavior, and smoke checks for scaffolding.
