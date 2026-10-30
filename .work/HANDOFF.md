# Handoff to Claude Code

Date: 2026-10-29. Updated by Codex after reviewing commit `f1c2e50`.

## Task and current status

**Update (Claude Code, 2026-10-29):** all three findings of the `f1c2e50` review are addressed in the working tree, uncommitted. (1) One jump or restore at a time via a cross-window lock file (`hyperspace.lock`, stale after 30 s); an overlapping command is ignored; the startup recovery path uses the same lock. (2) The snapshot is published by write-then-rename; an unreadable or invalid one (unknown keys rejected) is cleared and raises an error. (3) User approved narrowing: the editor area is always kept, spec criteria 2-4, the out-of-scope list and the glossary updated. Two new regression tests at the same seam; lint, build, test (6 passing) and package were run. Not covered: real two-window use and crash behaviour, still manual.

Hyperspace is implemented in commit `f1c2e50`. Codex reviewed that commit and its associated source/configuration against the revised spec, finding one P1 and two P2 issues below. All four committed tests, lint, build, and packaging passed, but controlled reproductions exposed concurrency and invalid-snapshot failures.

The earlier spec-review findings were resolved by the user: settings restore exactly; closed areas stay closed; workspace overrides hide the rest and produce a message; hyperspace is one shared state across windows; automated cases cover set/unset/override settings, with reload recovery kept manual. Do not reopen those settled choices. The spec remains `ready-for-agent`.

Claude's next assignment: address the implementation review, starting with a regression for finding 1 and safe snapshot handling for finding 2. For finding 3, implement the promised control or get user approval to narrow the spec. Do not independently change approved scope or select unresolved architecture for the user. No fixes were made by Codex.

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
- Reviewed commit and current HEAD: `f1c2e5028575aa9d683b39d2892f27b34da18ace` (`feat: add jump to hyperspace command`). Review range: `f1c2e50^..f1c2e50`.
- Working tree was clean before and after review, and before this handoff update. This handoff is the only intended uncommitted change.
- Earlier handoff branch/baseline and untracked-spec claims are obsolete.

## Review findings

Scope: the requested commit, revised spec, changed source and its callers, tests, package contributions, test configuration, and packaging exclusions. Unrelated local changes were excluded; none were present.

1. **P1 - Overlapping commands lose the restore snapshot** ([hyperspace.ts](../packages/towelwise/src/hyperspace.ts), lines 36-38, 50-57, 69-76). Exclusive file creation prevents overwrite, but does not serialize a whole transition. A second toggle can restore and remove the snapshot while the first is awaiting a settings update; the first then finishes hiding chrome. Final state: bars hidden, `isActive` false, and no original values to restore. Serialize jump/restore across windows, including the startup recovery path in [extension.ts](../packages/towelwise/src/extension.ts), and cover the overlap with a regression.
2. **P2 - Interrupted snapshot creation can disable every later toggle** ([hyperspace.ts](../packages/towelwise/src/hyperspace.ts), lines 50 and 71). The state file becomes visible before its JSON write completes. If interrupted, an empty/truncated file marks hyperspace active, but every restore throws at `JSON.parse`. Publish a completed snapshot atomically without replacing another session, and handle invalid state explicitly. Simulating an empty state file reproduced `Unexpected end of JSON input` on toggle.
3. **P2 - Missing editor-area control required by the spec** ([package.json](../packages/towelwise/package.json), lines 64-77; [hyperspace.ts](../packages/towelwise/src/hyperspace.ts), lines 19-23). Criterion 4 requires a setting for every area, and the glossary includes the editor area. Only primary sidebar, secondary sidebar, and bottom-panel controls exist. Implement a compliant editor-area control or obtain explicit approval to exclude it; preserve the prohibition on closing agent panels/non-agent editor tabs.

Reproduction details: inline Node scripts loaded the freshly compiled `out/hyperspace.js` into a VM with in-memory filesystem and VS Code mocks; they did not edit source files or real user settings. For finding 1, start with all three global chrome values unset, pause the first jump's activity-bar update, await a second toggle to restore/delete the snapshot, then resume the first. All three hidden values remain while `isActive` is false. For finding 2, expose an existing empty state file and call toggle; it rejects with `SyntaxError` and the state still appears active. These are controlled module reproductions, not live two-window or crash tests.

## Verification actually run for this commit

Commands ran from the repo root on Windows, Node 24.18.0 / npm 11.16.0.

| Command | Exit | Result |
| --- | --- | --- |
| `npm.cmd run lint` | 0 | ESLint passed. |
| `npm.cmd run build` | 0 | TypeScript compiled. |
| `npm.cmd test` outside sandbox | 0 | All four tests passed on VS Code 1.144.0: activation plus unset/set/workspace-override cases. |
| `npm.cmd run package` | 0 | Produced `packages/towelwise/towelwise.vsix`, six entries including compiled extension and hyperspace modules. |
| Inline `node -` module reproductions | 0 | Assertions confirmed the overlapping-toggle and empty-snapshot failures described above. |
| `git diff --check` / `git status --short` | 0 | No whitespace errors; clean tree after review. |

Use `npm.cmd` in this PowerShell environment: the earlier bootstrap review found `npm.ps1` blocked by execution policy. That review also found the sandbox blocks Electron startup; the current extension tests ran outside it. Do not confuse those earlier environment failures with current test failures.

Codex did not rerun a clean `npm ci`. Claude's earlier successful install and checks are reported separately in TRIAL.md; they are not fresh Codex verification.

## Pending work and next action

Smallest next action: turn finding 1's controlled overlap into a failing regression, then address the shared transition safely. Complete finding 2 and resolve finding 3 without silently narrowing the approved spec. Keep fixes uncommitted for independent review unless the user requests a commit. This handoff does not authorize pushing, publishing, or editor installation.

- Current `ROADMAP.md` marks Phase 1 done except `docs/decisions/`. Earlier handoff entries describing bootstrap CI/manual VSIX checks as pending are historical; this review did not independently verify their later completion.
- Actual two-window operation, reload/crash recovery, optional area controls, manual VSIX installation for this feature, Linux/headless CI, macOS menu-bar behavior, and compatibility at VS Code 1.90 remain unchecked by Codex. Reload recovery is an approved manual check.
- Open VSX verification was pending in the bootstrap spec; its current status was not rechecked. Claude starter-skill discovery/execution evidence was also unestablished in the older trial record; do not claim completion from file existence.
- Bootstrap defaults (package path, VS Code floor, CI Node/runner, and packaging approach) were flagged in the previous review, with no user approval captured in this conversation.
- Keybinding (`ctrl+alt+h`), exact settings/commands, and saved-state storage are implementation defaults flagged by the active spec; no approval beyond that spec was established in this review.
- TRIAL.md, the spec, and application code were left unchanged. Current review evidence is recorded here.

Suggested skills: `grill-with-docs` for unresolved next-slice choices, `to-spec` before substantial implementation, `diagnosing-bugs` if a real check fails, `code-review` for the next independent review, and `handoff` when transferring work. Discover them in the receiving host; do not assume availability. Use `tdd` for agreed behavior, and smoke checks for scaffolding.
