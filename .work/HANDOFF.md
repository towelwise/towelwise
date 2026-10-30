# Handoff

Date: 2026-10-30. Updated by Codex after reviewing Phase 2 slice 2 (saved layout), commit `9f19831`.

## Task and current status

**Update (Claude Code, 2026-10-30):** the three `9f19831` findings are addressed in the working tree, uncommitted. (3) `towelwise.layout.*` settings are now `scope: application` (a workspace test fails without it; confirmed). (2) Restore runs each container's first-view `<viewId>.focus` command, falling back to the container command; views come from extension manifests. (1) Per the user, no attempt to detect the enabled container: the picker lists all with area and id, and `restoreLayout` returns `{ ran, skipped }` (renamed from `shown`). Also: non-string entries in a hand-edited layout are ignored. Lint, build, test (23 passing) and package exit 0. Still untested: the picker and `liveVsCode` view discovery, and whether `.focus` reliably reopens a closed side bar for each agent (manual check). The saved-layout defaults are still unapproved.

Phase 2 slice 2 (**saved layout**) is implemented and committed locally as `9f19831`. Codex reviewed `f039d80...9f19831` against the active spec and reported three open P2 findings below. No implementation files were edited. Per the implementer's handoff, the branch is not pushed and has no PR; this review took no remote actions. Phase 2 slice 1 (hyperspace, with opt-in full screen) is merged to `main` (PRs #5 and #6) after two Codex review rounds with no open findings.

Next assistant's assignment: address the review findings when the user requests fixes, resolve the unapproved implementer defaults with the user, then repeat the relevant checks and obtain an independent review. Do not treat this handoff as authorization to change implementation. Manual checks below still need the user.

## References

- Instructions: [AGENTS.md](../AGENTS.md), [CLAUDE.md](../CLAUDE.md).
- Roadmap: [ROADMAP.md](../ROADMAP.md), Phase 2 (slice 2 reworded to "Saved layout"; "Named layouts" added as slice 4).
- Active spec: [phase-2-saved-layout.md](specs/phase-2-saved-layout.md), `Status: ready-for-agent`. Its "Implementer defaults" section is NOT yet approved by the user.
- Terms: [GLOSSARY.md](../GLOSSARY.md) (new term: Layout).
- Decisions: [0001](../docs/decisions/0001-hyperspace-works-by-area-not-by-agent.md), [0002](../docs/decisions/0002-hyperspace-writes-user-settings-and-restores-exactly.md), [0003](../docs/decisions/0003-hyperspace-never-reads-or-reopens-layout-state.md). Saved layout follows from 0003 (declared, not captured); no new record.
- Previous spec (merged): [phase-2-hyperspace.md](specs/phase-2-hyperspace.md).
- Review findings: [Open review findings](#open-review-findings) below. Earlier hyperspace findings are all resolved; see `git log` for the fix commits.

## Git state

- Branch: `feat/saved-layout`. Baseline: `main` at `f039d80` (`feat: add opt-in full screen to hyperspace, plus decision records (#6)`).
- HEAD: `9f19831` (`feat: add saved layout with choose and restore commands`). Branch, HEAD and parent were checked by Codex; remote status is carried from the implementer's handoff.
- Uncommitted: this handoff file only.

## What was built (see the code, not repeated here)

[layout.ts](../packages/towelwise/src/layout.ts): `restoreLayout`, `applyOnStartup`, `chooseLayout`, `liveVsCode`. Wiring in [extension.ts](../packages/towelwise/src/extension.ts); commands, `Ctrl+Alt+L` and the `towelwise.layout.*` settings in [package.json](../packages/towelwise/package.json). Tests in [layout.test.ts](../packages/towelwise/src/test/layout.test.ts) use a stand-in for VS Code (the approved seam); the activation test checks all three commands are registered.

## Open review findings

1. **P2 - Inactive Codex containers appear as valid choices.** [layout.ts](../packages/towelwise/src/layout.ts):64 checks only whether the command is registered. Installed Codex contributes `codexViewContainer` and `codexSecondaryViewContainer`, whose views have opposite `chatgpt.doesNotSupportSecondarySidebar` conditions. VS Code registers container commands separately from their enablement, so both pass this check. Choosing the inactive container cannot restore the intended Codex view, yet restore counts it as shown. Evidence: installed Codex 26.1021.22027 manifest and VS Code command-registration source; actual picker UI not exercised. See [VS Code registration and enablement](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/views/browser/viewsService.ts#L359).
2. **P2 - Restore can close an agent moved to the bottom panel.** [layout.ts](../packages/towelwise/src/layout.ts):33 runs the container command without accounting for its toggle behavior in the panel. With one saved agent moved there, visible and focused, pressing Restore Layout again closes it, contrary to acceptance criterion 2. Verified command semantics in cached VS Code 1.144.0 and [upstream source](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/views/browser/viewsService.ts#L402); manual UI reproduction remains pending.
3. **P2 - Workspace settings override the global saved layout.** [package.json](../packages/towelwise/package.json):102 omits `scope` for `towelwise.layout.containers`, so it defaults to `window`. A workspace setting of `[]` overrides the user layout read by `savedContainers`; Choose Layout still writes globally, so confirming another selection does not fix restore in that project. This violates the shared-across-projects requirement. Evidence: manifest, configuration reads/writes, and [VS Code scope rules](https://code.visualstudio.com/api/references/contribution-points#scope); no workspace-override regression test was run.

The existing tests use stand-in commands and do not cover these failures. No fixes or regression tests were added during review.

## Verification actually run

Codex independently reran the following on Windows from the repo root while reviewing `9f19831`, using `code-review` at `C:/Users/thisi/.agents/skills/code-review/SKILL.md`:

| Command | Exit | Result |
| --- | --- | --- |
| `npm.cmd run lint` | 0 | passed |
| `npm.cmd run build` | 0 | compiled |
| `npm.cmd test` (sandboxed) | 1 | VS Code launch blocked by sandbox/ACL; not a test failure |
| `npm.cmd test` (outside sandbox) | 0 | 20 passing on VS Code 1.144.0 |
| `npm.cmd run package` | 0 | produced `packages/towelwise/towelwise.vsix`; not installed |
| `git diff --check f039d80...HEAD` | 0 | no whitespace errors |

Claude Code's earlier handoff reported the same four project checks passing before the commit, and reported that new tests failed to compile before `layout.ts` existed. Those are implementer reports, separate from the Codex rerun above. CI has not been verified on this commit. Use `npm.cmd` in PowerShell (`npm.ps1` is blocked by execution policy).

## Further review and test gaps

- `discoverContainers` and `chooseLayout` (picker list, order, "Not installed" entries) have no automated test; only `restoreLayout` and `applyOnStartup` do.
- Whether `workbench.view.extension.<id>` and `workbench.action.chat.open` are the right show commands, and "available" meaning the command exists in `getCommands(true)`.
- A hand-edited `towelwise.layout.containers` with non-string entries.
- Startup apply: silent about skipped containers by design; runs even when another window started hyperspace only if its state file is absent (it checks the shared file).

## Remaining work and checks still pending

Smallest next action: the user decides how to proceed with the three P2 findings. Fixes have not been requested. The next implementer should preserve approved decisions and ask about unresolved choices before dependent implementation.

- Manual (needs the user, and a build installed then windows reloaded): choose Antigravity and Codex in Choose Layout; close both side bars and run Restore Layout; run it in another project; turn on startup apply and reload; with a side bar set to hide in hyperspace, jump, reload, and confirm startup apply does not reopen it. The open spec question is whether the show command reliably opens a closed side bar for each agent.
- Not checked anywhere: CI for this branch, macOS, VS Code 1.90 floor, the picker UI.
- The user has not approved the saved-layout implementer defaults (key, setting names, picker contents, availability detection).
- Hyperspace follow-ups still open: the user confirmed multi-window restore works and that the full-screen setting appears after a window reload, but has not explicitly confirmed full screen engaging and exiting; reload recovery with full screen is unconfirmed. Known limits: a crash between a successful full-screen toggle and recording it leaves a full-screen window restore does not know about (F11 fixes it); PID reuse can delay lock recovery up to one hour; crashes can leave ignored `hyperspace.tmp.*` files.
- After installing a VSIX, windows must be reloaded or they keep the old manifest. This is not yet written into AGENTS.md (offered, not requested).
- Bootstrap defaults (package path `packages/towelwise/`, `engines.vscode ^1.90.0`, CI Node 22 on `ubuntu-latest`, packaging flags) were flagged in the Phase 1 review and never explicitly approved.
- Not authorized by this handoff: pushing, opening a PR, publishing, installing a VSIX. Each is a separate request.

Suggested skills: `tdd` for regression tests when fixes are authorized; `code-review` for the follow-up review; `diagnosing-bugs` if a manual check fails; `grill-with-docs` then `to-spec` for unresolved scope or the next slice; `handoff` when transferring again. Discover skills in the receiving host; do not assume availability. This handoff update used `handoff` at `C:/Users/thisi/.agents/skills/handoff/SKILL.md`.
