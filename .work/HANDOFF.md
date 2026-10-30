# Handoff

Date: 2026-10-30. Updated by Codex after independently reviewing the latest saved-layout fix and rerunning local checks. Handoff skill: `C:/Users/thisi/.agents/skills/handoff/SKILL.md`.

## Task and current status

Phase 2 slice 2 (**saved layout**) is implemented on `feat/saved-layout`. Codex reviewed `9f19831` (three P2 findings), then `3b0b96e` (one P2 finding: a later extension overwrote a container's first view). Claude fixed every finding. **Codex reviewed the last fix (`43b2972`), the docs commit (`e436389`), and the uncommitted handoff update: no findings.** The user approved the saved-layout implementer defaults and confirmed the main manual checks by hand (below). The branch is ready to push and open as a PR when the user requests it; CI and the remaining manual checks are pending.

Phase 2 slice 1 (hyperspace, with opt-in full screen) is merged to `main` (PRs #5, #6).

Next assistant's assignment: continue from the completed review below. If the user requests pushing/opening a PR, use this branch and check CI. Otherwise help complete the remaining manual checks when requested. No implementation fix is outstanding.

## References

- Instructions: [AGENTS.md](../AGENTS.md), [CLAUDE.md](../CLAUDE.md).
- Roadmap: [ROADMAP.md](../ROADMAP.md), Phase 2 (slice 2 "Saved layout"; slice 4 "Named layouts" is a later slice).
- Active spec: [phase-2-saved-layout.md](specs/phase-2-saved-layout.md), `Status: ready-for-agent`. Its implementer defaults are now approved, and it records the manual results so far.
- Terms: [GLOSSARY.md](../GLOSSARY.md) (Layout, Agent panel, Area, Chrome, Hyperspace, Restore).
- Decisions: [0001](../docs/decisions/0001-hyperspace-works-by-area-not-by-agent.md), [0002](../docs/decisions/0002-hyperspace-writes-user-settings-and-restores-exactly.md), [0003](../docs/decisions/0003-hyperspace-never-reads-or-reopens-layout-state.md). Saved layout follows from 0003 (declared, not captured); no new record.
- Previous spec (merged): [phase-2-hyperspace.md](specs/phase-2-hyperspace.md).
- Review findings: [Review outcome](#review-outcome) below. Earlier findings are addressed; see the fix commit messages. No findings are currently open.

## Git state

- Branch: `feat/saved-layout`. Slice baseline: `f039d80` (`feat: add opt-in full screen to hyperspace, plus decision records (#6)`), the parent of `9f19831`. Local `main` is still at `75a1920`; use the explicit slice baseline for comparisons. No remote refresh was performed.
- Commits on the branch: `9f19831` (feature), `3b0b96e` (fixes for review round 1), `43b2972` (owner-first view mapping, fix for review round 2), `e436389` (docs: approved defaults and manual results). HEAD is `e436389`.
- Previous handoff reports not pushed, no PR, and an existing `origin`; remote status was not independently queried. Uncommitted: this handoff file only. Branch, HEAD and slice baseline were verified locally.

## What the slice does (see the code and spec; not repeated here)

[layout.ts](../packages/towelwise/src/layout.ts): `restoreLayout`, `applyOnStartup`, `chooseLayout`, `liveVsCode`, `viewsByContainer`. Wiring in [extension.ts](../packages/towelwise/src/extension.ts); commands, `Ctrl+Alt+L` and the `towelwise.layout.*` settings in [package.json](../packages/towelwise/package.json). Tests: [layout.test.ts](../packages/towelwise/src/test/layout.test.ts) (stand-in VS Code, the approved seam) and the activation test.

## Review outcome

Codex used `code-review` at `C:/Users/thisi/.agents/skills/code-review/SKILL.md`. Reviewed `3b0b96e..e436389`, the uncommitted handoff update, and connected layout implementation, tests, activation wiring and manifest against the active spec. This was a focused follow-up, not a fresh review of every line in the full slice.

No bugs or other review findings. The owner-first mapping follows the approved rule; regression tests cover both extension orders and fallback when the owner contributes no view. Implementation files were left unchanged.

## Verification actually run

Codex, Windows, repo root, at `e436389`, 2026-10-30:

| Command | Exit | Result |
| --- | --- | --- |
| `npm.cmd run lint` | 0 | passed |
| `npm.cmd run build` | 0 | compiled |
| `npm.cmd test` (sandbox) | 1 | build passed; Windows ACLs blocked VS Code launch, so tests did not run |
| `npm.cmd test` (outside sandbox) | 0 | 25 passing on VS Code 1.144.0 |
| `npm.cmd run package` | 0 | produced `packages/towelwise/towelwise.vsix`, including compiled layout code |
| `git diff --check 3b0b96e..HEAD` | 0 | passed |

Earlier evidence: Claude reported lint/build/test/package passing at `43b2972` (25 tests), tests written first, and the workspace-override regression failing without application scope. Codex's earlier review at `3b0b96e` independently passed 23 tests. These are separate from the current results above. **CI has not been verified; the previous handoff reports no CI run on this branch.** Use `npm.cmd` in PowerShell; tests needed execution outside the sandbox.

The build from `43b2972` is installed in the user's VS Code. After any VSIX install, windows must be reloaded or they keep the old manifest.

## Manual checks

Confirmed by the user on their machine (Antigravity, Claude Code, Codex, Chat): Choose Layout saved a selection; Restore Layout reopened the closed side bars as chosen; hyperspace with one agent open jumped and restored; `Ctrl+Alt+L` afterwards brought back the three-column layout.

Still unchecked: restore in another project; startup apply (`towelwise.layout.applyOnStartup`) after a reload; startup apply while hyperspace hides a side bar (the "hyperspace wins" rule); hyperspace full screen (`towelwise.hyperspace.fullScreen`) engaging and exiting, and reload recovery with it; macOS; the VS Code 1.90 floor.

## Coverage limits

- `discoverContainers`/`chooseLayout` (picker list, order, "Not installed" entries) have no automated test.
- Real view visibility beyond the user's manual checks remains unverified. Restore reports commands run, not visibility (VS Code cannot say which of an extension's containers is enabled; this is an approved limit).
- Startup apply is silent about skipped containers by design.

## Known limits and open items carried forward

- Hyperspace: a crash between a successful full-screen toggle and recording it leaves a full-screen window that restore does not know about (F11 fixes it). PID reuse can delay lock recovery up to one hour; crashes can leave ignored `hyperspace.tmp.*` files.
- Not written into AGENTS.md (offered, not requested): reload windows after installing a VSIX.
- Bootstrap defaults (package path `packages/towelwise/`, `engines.vscode ^1.90.0`, CI Node 22 on `ubuntu-latest`, packaging flags) were flagged in the Phase 1 review and never explicitly approved.
- Not authorized by this handoff: pushing, opening a PR, publishing, installing a VSIX. Each is a separate request.

## Smallest next action

Review is complete with no findings. If the user asks: push `feat/saved-layout`, open the PR, and check CI. Remaining manual checks above still need completion. Phase 2 after that: slice 3 (beginner profile) and slice 4 (named layouts), each needing its own grilling and spec.

Suggested skills: `code-review` for subsequent changes; `tdd` for any fix; `diagnosing-bugs` if a manual check fails; `grill-with-docs` then `to-spec` for the next slice; `handoff` when transferring again. Discover skills in the receiving host; do not assume availability.
