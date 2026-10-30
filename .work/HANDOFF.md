# Handoff

Date: 2026-10-30. Updated by Codex after re-reviewing Phase 2 slice 2 (saved layout), commit `3b0b96e`.

## Task and current status

**Update (Claude Code, 2026-10-30):** the `3b0b96e` discovery finding is addressed in a new commit. `viewsByContainer` (exported from layout.ts, called by `liveVsCode`) prefers the first view from the extension that declares the container and falls back to another extension's view only if the owner contributes none. Two tests with fake manifests cover both load orders and the fallback. Lint, build, test (25 passing) and package exit 0. The VSIX was then built from the committed state and installed into the user's VS Code at the user's request; windows must be reloaded. Manual checks are the user's next step.

Phase 2 slice 2 (**saved layout**) is implemented in `9f19831`, with review fixes committed as `3b0b96e`. Codex re-reviewed both the fixes (`git show 3b0b96e`) and the full slice (`f039d80...3b0b96e`) against the updated spec. One P2 finding remains below: manifest discovery lets a later extension overwrite a container's first-view mapping. No implementation files were edited during either review.

The earlier workspace-override finding is fixed by application scope. The generated view-focus command avoids toggling; the container-command fallback is explicitly approved in the spec. Listing all containers with area/id and returning `{ ran, skipped }` is also now approved, so do not reopen the earlier inactive-container-listing finding. Non-string entries in the layout array are ignored and tested. The remaining implementer defaults and manual checks are still pending.

Per the implementer's earlier handoff, the branch is not pushed and has no PR; Codex took no remote actions. Phase 2 slice 1 (hyperspace, with opt-in full screen) is merged to `main` (PRs #5 and #6), with no open code-review findings from those rounds.

Next assistant's assignment: when the user requests a fix, address the remaining discovery finding and add a regression covering multiple extensions contributing to one container. Preserve the updated approved decisions; resolve any ownership-rule ambiguity with the user before dependent implementation. Repeat the relevant checks and obtain an independent review. This handoff does not authorize implementation changes. Manual checks below still need the user.

## References

- Instructions: [AGENTS.md](../AGENTS.md), [CLAUDE.md](../CLAUDE.md).
- Roadmap: [ROADMAP.md](../ROADMAP.md), Phase 2 (slice 2 reworded to "Saved layout"; "Named layouts" added as slice 4).
- Active spec: [phase-2-saved-layout.md](specs/phase-2-saved-layout.md), `Status: ready-for-agent`. Its "Approved decisions" section now records the review resolutions; the remaining "Implementer defaults" are not approved.
- Terms: [GLOSSARY.md](../GLOSSARY.md) (new term: Layout).
- Decisions: [0001](../docs/decisions/0001-hyperspace-works-by-area-not-by-agent.md), [0002](../docs/decisions/0002-hyperspace-writes-user-settings-and-restores-exactly.md), [0003](../docs/decisions/0003-hyperspace-never-reads-or-reopens-layout-state.md). Saved layout follows from 0003 (declared, not captured); no new record.
- Previous spec (merged): [phase-2-hyperspace.md](specs/phase-2-hyperspace.md).
- Review findings: [Open review findings](#open-review-findings) below. Earlier hyperspace findings are all resolved; see `git log` for the fix commits.

## Git state

- Branch: `feat/saved-layout`. Baseline: `main` at `f039d80` (`feat: add opt-in full screen to hyperspace, plus decision records (#6)`).
- HEAD: `3b0b96e` (`fix: make saved layout safe against overrides and panel toggling`), parent `9f19831`. Branch, HEAD, parent and baseline were checked by Codex; remote status is carried from the implementer's handoff.
- Working tree was clean before this update; uncommitted work is now this handoff file only.

## What was built (see the code, not repeated here)

[layout.ts](../packages/towelwise/src/layout.ts): `restoreLayout`, `applyOnStartup`, `chooseLayout`, `liveVsCode`. Wiring in [extension.ts](../packages/towelwise/src/extension.ts); commands, `Ctrl+Alt+L` and the `towelwise.layout.*` settings in [package.json](../packages/towelwise/package.json). Tests in [layout.test.ts](../packages/towelwise/src/test/layout.test.ts) use a stand-in for VS Code (the approved seam); the activation test checks all three commands are registered.

## Open review findings

1. **P2 - Later extensions overwrite a container's intended first view.** [layout.ts](../packages/towelwise/src/layout.ts):35 unconditionally sets the container-to-view map while iterating every extension's contributions. If the owner contributes `owner.view` to `agent`, then an add-on contributes `addon.view` to that same container with a false `addon.enabled` condition, discovery replaces the owner mapping with `addon.view`. Its focus command still exists, so restore runs it; VS Code does not open inactive views, leaving the intended agent closed. This differs from the accepted limitation about listing inactive containers: a working container's mapping is replaced by another extension's contribution. No fix has been requested yet.

Evidence: a Node VM probe loaded the compiled `layout.js` with two stand-in extension manifests and the real `liveVsCode`/`restoreLayout` code. Output: `{"ownerFirstView":"owner.view","discoveredView":"addon.view","commandsRun":["addon.view.focus"]}`. This reproduces incorrect command selection, not a manual UI run. The inactive-view no-op and non-toggling focus semantics were inspected in cached VS Code 1.144.0 and [upstream source](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/views/browser/viewsService.ts#L268). No fixes or regression tests were added during review.

## Verification actually run

Codex independently reran the following on Windows from the repo root while re-reviewing `3b0b96e`, using `code-review` at `C:/Users/thisi/.agents/skills/code-review/SKILL.md`:

| Command | Exit | Result |
| --- | --- | --- |
| `npm.cmd run lint` | 0 | passed |
| `npm.cmd run build` | 0 | compiled |
| `npm.cmd test` (outside sandbox) | 0 | 23 passing on VS Code 1.144.0 |
| `npm.cmd run package` | 0 | produced `packages/towelwise/towelwise.vsix`; not installed |
| `git diff --check f039d80...3b0b96e` | 0 | no whitespace errors |
| PowerShell here-string piped to `node` (VM probe described above) | 0 | reproduced the incorrect view/command selection |

The first Codex review of `9f19831` also passed lint/build/package and 20 tests; its initial sandboxed test launch failed with an ACL error, then passed outside the sandbox. Claude Code reported 23 passing tests for the fixes, independently confirmed by the re-review above. CI has not been verified on `3b0b96e`. Use `npm.cmd` in PowerShell (`npm.ps1` is blocked by execution policy).

## Further review and test gaps

- `liveVsCode`, `discoverContainers` and `chooseLayout` have no automated tests. The VM probe was exploratory; it was not added to the suite. The existing focus test supplies an already-built view map, so it bypasses discovery.
- Actual side-bar reopening, repeated restore with an agent in the bottom panel, and saved-order behavior when two containers share an area remain manual checks. The focus-command implementation avoids toggling; this source inspection does not establish those runtime results.
- Availability still means a command exists in `getCommands(true)`, as accepted by the updated spec. Picker cancellation, selection order and "Not installed" entries remain untested.
- Startup apply: silent about skipped containers by design; runs even when another window started hyperspace only if its state file is absent (it checks the shared file).

## Remaining work and checks still pending

Smallest next action: when the user requests the remaining fix, add a failing discovery regression for two extensions contributing to one container, then correct the mapping. Preserve approved decisions and ask about unresolved choices before dependent implementation.

- Manual (needs the user, and a build installed then windows reloaded): choose Antigravity and Codex in Choose Layout; close both side bars and run Restore Layout; run it in another project; turn on startup apply and reload; with a side bar set to hide in hyperspace, jump, reload, and confirm startup apply does not reopen it. The open spec question is whether the show command reliably opens a closed side bar for each agent.
- Not checked anywhere: CI for this branch, macOS, VS Code 1.90 floor, the picker UI.
- The spec still marks implementer defaults unapproved (including key, setting names/identifiers and exact picker presentation). Its newer approved review decision covers listing all containers with area/id, reporting commands run, first-view focus with fallback, and application scope; preserve those approvals.
- Hyperspace follow-ups still open: the user confirmed multi-window restore works and that the full-screen setting appears after a window reload, but has not explicitly confirmed full screen engaging and exiting; reload recovery with full screen is unconfirmed. Known limits: a crash between a successful full-screen toggle and recording it leaves a full-screen window restore does not know about (F11 fixes it); PID reuse can delay lock recovery up to one hour; crashes can leave ignored `hyperspace.tmp.*` files.
- After installing a VSIX, windows must be reloaded or they keep the old manifest. This is not yet written into AGENTS.md (offered, not requested).
- Bootstrap defaults (package path `packages/towelwise/`, `engines.vscode ^1.90.0`, CI Node 22 on `ubuntu-latest`, packaging flags) were flagged in the Phase 1 review and never explicitly approved.
- Not authorized by this handoff: pushing, opening a PR, publishing, installing a VSIX. Each is a separate request.

Suggested skills: `tdd` for regression tests when fixes are authorized; `code-review` for the follow-up review; `diagnosing-bugs` if a manual check fails; `grill-with-docs` then `to-spec` for unresolved scope or the next slice; `handoff` when transferring again. Discover skills in the receiving host; do not assume availability. This handoff update used `handoff` at `C:/Users/thisi/.agents/skills/handoff/SKILL.md`.
