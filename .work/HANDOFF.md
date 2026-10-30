# Handoff

## 2026-10-30 — Claude Code: startup race fixed; PR opened for feat/walkthrough

### For the reviewer

Codex's P2 (startup apply could reopen panels after another window started hyperspace) is fixed in the latest commit: [layout.ts](../packages/towelwise/src/layout.ts) `applyOnStartup` now rechecks `isActive` after `await env()`. A regression test turns hyperspace on from inside the environment factory; it failed before the fix. No other code changed. Review that commit only; no other findings are open from the `e7cccfc..e796f42` review.

### Status

- Branch `feat/walkthrough`, pushed, PR open against `main` (baseline `origin/main` `3399db6`). The user merges it.
- Next after the merge: the user asked Claude to build and install the merged result for manual checks. Reload windows after installing; the shortcuts are now `Ctrl+K H` and `Ctrl+K L`.

### Checks

Claude Code, Windows, repo root: `npm run lint` 0; `npm run build` 0; `npm test` 0 (37 passing); `npm run package` 0. CI result is recorded on the PR, not here.

### Still open

Unchanged from the Codex entry below: manual checks, bootstrap defaults, the AGENTS.md lines, the npm-workspaces rationale, weekly hours and next slice, and the known limits.

### Next action

User merges the PR; Claude builds and installs for manual checks. Then slice 4 (named layouts): `grill-with-docs`, then `to-spec`.

---

## 2026-10-30 — Codex: review of e7cccfc..e796f42 complete; startup race remains open

### For the reviewer

Codex reviewed `e7cccfc...e796f42` and Claude's latest uncommitted handoff using `code-review` at `C:/Users/thisi/.agents/skills/code-review/SKILL.md`. One finding remains:

**P2 — Startup restore can reopen panels after hyperspace starts.** [layout.ts](../packages/towelwise/src/layout.ts):86 checks `isActive(storageDir)` before awaiting the environment factory at line 87. If another window enters hyperspace during that wait, automatic restore still issues view-focus commands. Recheck after `await env()` and add a regression where hyperspace becomes active while the factory is pending. The in-memory probe returned `applied: true` and ran `agent.view.focus` while hyperspace was active; this was a command-runner probe, not a real UI test.

The earlier walkthrough-test finding is fixed: all three previous broken-manifest variants are now detected. The lock extraction matches the previous constants and implementation apart from export/import wiring. No additional findings from the reviewed changes. No implementation or test files were edited.

Preserve the approved walkthrough defaults and shared media, `Ctrl+K H`/`Ctrl+K L`, automatic failed-jump rollback, the always-kept editor area, areas staying closed on restore, window-specific full-screen restoration, and reporting show commands run rather than visibility.

### Status

- Branch `feat/walkthrough`, HEAD `e796f42`. Full slice baseline and local `origin/main`: `3399db6`; follow-up review baseline: `e7cccfc`. Local `main` remains stale at `75a1920`. Refs were checked locally; no fetch was performed.
- Commits reviewed: `1df1b38` (walkthrough tests), `bea6b5e` (rollback, shortcuts and audit changes), `e796f42` (README, CI permissions and docs). Earlier walkthrough commit `e7cccfc` was reviewed separately.
- Uncommitted: `.work/HANDOFF.md` only. Claude reports the branch is not pushed and has no PR; remote status was not independently queried.
- References: [ROADMAP.md](../ROADMAP.md); specs [walkthrough](specs/phase-2-walkthrough.md), [saved layout](specs/phase-2-saved-layout.md), [hyperspace](specs/phase-2-hyperspace.md); decisions [0001](../docs/decisions/0001-hyperspace-works-by-area-not-by-agent.md), [0002](../docs/decisions/0002-hyperspace-writes-user-settings-and-restores-exactly.md), [0003](../docs/decisions/0003-hyperspace-never-reads-or-reopens-layout-state.md). Current review finding is recorded above.

### Checks

Codex independently ran these on Windows at `e796f42`, from the repo root:

| Command | Exit | Result |
| --- | --- | --- |
| `npm.cmd run lint` | 0 | passed |
| `npm.cmd run build` | 0 | compiled |
| `npm.cmd test` (outside sandbox) | 0 | 36 passing on VS Code 1.144.0 |
| `npm.cmd run package` | 0 | VSIX includes `readme.md`, `out/lock.js` and `media/walkthrough.md` |
| `git diff --check e7cccfc...HEAD` | 0 | passed |
| In-memory Node probes | 0 | reproduced startup race; each of three walkthrough mutations failed one of seven walkthrough tests |
| Node source comparison | 0 | lock extraction matches previous implementation |

These results are separate from Claude's checks below. Tests ran outside the sandbox because earlier VS Code launches encountered Windows ACL restrictions. CI and real-window checks remain pending; packaging does not establish installation or UI behavior.

### Still open

- The P2 startup race above needs a fix and independent review when requested.
- Manual checks: walkthrough rendering/buttons/completion and the new chords; saved layout in another project; startup apply after reload and while hyperspace hides a side bar; full screen engaging/exiting and reload recovery. macOS and the VS Code 1.90 floor remain unchecked. CI has not been independently verified; Claude reports no CI run on this branch.
- Installed build, per Claude: saved-layout commit `43b2972`, with old `Ctrl+Alt+H/L` shortcuts and none of the walkthrough, new chords or rollback. Reload windows after any authorized VSIX installation.
- Earlier intermittent walkthrough command-registration failure had no established cause. The suite now activates the extension itself and the current run passed; investigate if it recurs.
- Carried decisions still pending: bootstrap defaults (package path, VS Code floor, CI Node/OS); proposed AGENTS.md notes about reloads and handoff format; npm-workspaces ADR rationale; roadmap weekly-hours/next-slice question. The newest-first handoff format is already active in both hosts' skill copies.
- Known limits: full-screen toggle/record crash window (F11 recovery), PID reuse delaying lock recovery up to one hour, ignored temporary files after crashes, and no automated picker/discovery/recovery-prompt coverage beyond `orderChoices`.
- Push, PR creation, publishing and VSIX installation each require a separate user request.

### Next action

When the user requests a fix, use `tdd` for the startup race regression and fix, then `code-review` for independent verification. Use `diagnosing-bugs` if a manual check or the intermittent test fails, and `handoff` to record the outcome. Once resolved and separately requested, push/open the PR and check CI. Named layouts (slice 4) needs its own `grill-with-docs` session and `to-spec`; discover these skills in the receiving host.

---

## 2026-10-30 — Claude Code: ready for review of e7cccfc..e796f42 (walkthrough fixes, audit items, new shortcuts)

### For the reviewer

Review `git diff e7cccfc..e796f42` on `feat/walkthrough` using `code-review`; record findings in a new entry above this one and do not fix them unless asked. Compare against `origin/main` (`3399db6`), not local `main`, which is a stale ref.

Where to focus:

- `1df1b38` answers your earlier P2: the walkthrough tests are now table-driven. Claude checked them by applying your three breakages (Choose redirected to Restore, Choose button removed, Settings completion event removed) to `package.json` one at a time: each now fails (2, 1 and 1 failing); file restored. Please confirm the tests really pin every step.
- `bea6b5e`, in [hyperspace.ts](../packages/towelwise/src/hyperspace.ts) `toggle`: a jump that throws now calls `restoreSnapshot` (errors swallowed) and rethrows. Check the undo cannot toggle full screen back, and that a real crash still leaves the saved copy for the startup offer.
- `bea6b5e`, [lock.ts](../packages/towelwise/src/lock.ts): meant to be a pure move of the lock code out of hyperspace.ts. Please confirm nothing changed in behavior.
- `bea6b5e`: `options.get<boolean>(...)` replaces the fallback defaults in hyperspace.ts (VS Code returns the `package.json` default for registered settings); `applyOnStartup` in [layout.ts](../packages/towelwise/src/layout.ts) now takes a factory so its environment is built only when the setting is on; `orderChoices` extracted and tested; walkthrough suite activates the extension itself; `repository` field added and `--allow-missing-repository` dropped.
- `e796f42`: [README](../packages/towelwise/README.md) accuracy (wording is Claude's, unreviewed by the user), `permissions: contents: read` in CI, one sentence about Settings Sync in [decision 0002](../docs/decisions/0002-hyperspace-writes-user-settings-and-restores-exactly.md).

Already decided by the user; do not reopen: walkthrough wording, id, button commands and the shared media file (approved); a failed jump rolls back automatically (option A); default shortcuts are the chords `Ctrl+K H` (hyperspace) and `Ctrl+K L` (layout), chosen over `Ctrl+Alt+H/L` because Ctrl+Alt is AltGr on Windows; the editor area is always kept; closed areas stay closed on restore; full screen is opt-in and only the jumping window toggles it back; restore reports commands run, not visibility.

### Status

- Branch `feat/walkthrough`. Baseline `origin/main` at `3399db6` (saved layout, PR #7). HEAD `e796f42`.
- Commits on the branch: `e7cccfc` (walkthrough, reviewed earlier), `1df1b38` (stronger tests plus spec approval of the walkthrough defaults), `bea6b5e` (rollback, shortcuts, audit fixes), `e796f42` (README, CI permissions, ADR note, spec notes).
- Not pushed; no PR. Uncommitted: this handoff file only.
- Specs: [phase-2-walkthrough.md](specs/phase-2-walkthrough.md), [phase-2-saved-layout.md](specs/phase-2-saved-layout.md), [phase-2-hyperspace.md](specs/phase-2-hyperspace.md); decisions [0001](../docs/decisions/0001-hyperspace-works-by-area-not-by-agent.md), [0002](../docs/decisions/0002-hyperspace-writes-user-settings-and-restores-exactly.md), [0003](../docs/decisions/0003-hyperspace-never-reads-or-reopens-layout-state.md); [ROADMAP.md](../ROADMAP.md) (Phase 2 slice 3 is the walkthrough, 4 named layouts, 5 quiet profile).
- A whole-repo ponytail audit was run in chat (no saved file). All nine findings are now addressed: failed-jump rollback, shortcuts, picker-order test, lock split, dead defaults, startup work, package README and repository field, CI permissions, Settings Sync note.

### Checks

Claude Code, Windows, repo root, on the tree committed as `e796f42`:

| Command | Exit | Result |
| --- | --- | --- |
| `npm run lint` | 0 | passed |
| `npm run build` | 0 | compiled |
| `npm test` | 0 | 36 passing on VS Code 1.144.0 |
| `npm run package` | 0 | VSIX includes `readme.md`, `out/lock.js`, `media/walkthrough.md`; no packaging warnings |

New tests were written first and failed before each change. **CI has not run on this branch.** One earlier run failed a walkthrough test ("towelwise.layout.choose is not a registered command") and then passed five consecutive runs; the cause was not found. The suite now activates the extension itself. Treat a recurrence as real. Use `npm.cmd` in PowerShell; the sandbox blocks VS Code launch, so run tests outside it.

Pending, not run by anyone: the walkthrough read-through in a real window; the new `Ctrl+K H` and `Ctrl+K L` chords pressed in a real editor.

### Still open

- Manual checks (the user's): walkthrough read-through (nobody has seen it rendered); saved layout in another project, startup apply after a reload, and startup apply while hyperspace hides a side bar; hyperspace full screen engaging and exiting, and reload recovery with it. Not checked anywhere: macOS, the VS Code 1.90 floor.
- The build installed in the user's VS Code is the saved-layout build from `43b2972`: it has none of the walkthrough, the new shortcuts or the rollback, and its shortcuts are still `Ctrl+Alt+H/L`. Windows must be reloaded after any VSIX install.
- Awaiting the user: bootstrap defaults never approved (package path `packages/towelwise/`, `engines.vscode ^1.90.0`, CI Node 22 on `ubuntu-latest`); two AGENTS.md lines offered (reload after install; the newest-first handoff format, since Codex has its own copy of the handoff skill); rationale for an npm-workspaces decision record; the roadmap's weekly-hours question and which slice comes next.
- Known limits: a crash between a successful full-screen toggle and recording it leaves a full-screen window restore does not know about (F11 fixes it); PID reuse can delay lock recovery up to one hour; crashes can leave ignored `hyperspace.tmp.*` files; the picker, container discovery and recovery prompt have no automated test beyond `orderChoices`.
- Not authorized by this handoff: pushing, opening a PR, publishing, installing a VSIX. Each is a separate request.

### Next action

Independent review of `e7cccfc..e796f42` by Codex. If clean and the user asks: push `feat/walkthrough` and open the PR, then check CI. After that, slice 4 (named layouts) needs its own grilling and spec. Suggested skills: `code-review` for the review; `tdd` for any fix; `diagnosing-bugs` if a manual check fails; `grill-with-docs` then `to-spec` for the next slice; `handoff` when transferring again.

---

## Earlier entry (older single-state format; the review findings in it are superseded by the entry above: the P2 was fixed in `1df1b38`)

Date: 2026-10-30. Updated by Codex after independently reviewing Phase 2 slice 3 (first-run walkthrough). Handoff skill: `C:/Users/thisi/.agents/skills/handoff/SKILL.md`. The saved-layout slice is merged (PR #7) after clean Codex review.

## Task and current status

Phase 2 slice 3 (**first-run walkthrough**) is implemented and committed locally as `e7cccfc` on `feat/walkthrough`. **Codex reviewed it: no production behavior defect found; one P2 test-coverage finding remains open below.** A P3 handoff baseline finding is corrected in this update. The earlier handoff reports no push or PR; remote status was not independently queried. Earlier slices are merged: slice 1 hyperspace with opt-in full screen (PRs #5, #6) and slice 2 saved layout (PR #7).

Next assistant's assignment: when the user requests a fix, strengthen the walkthrough manifest tests for the P2 finding below, rerun relevant checks and obtain an independent review. Implementer defaults still need the user's approval, and manual UI checks remain pending. This handoff authorizes no implementation changes or remote actions.

## References

- Instructions: [AGENTS.md](../AGENTS.md), [CLAUDE.md](../CLAUDE.md).
- Roadmap: [ROADMAP.md](../ROADMAP.md), Phase 2. This commit reshapes it: slice 3 is now "First-run walkthrough"; "Named layouts" is slice 4; the quiet VS Code profile is a new slice 5 (VS Code has no extension API to create a profile).
- Active spec: [phase-2-walkthrough.md](specs/phase-2-walkthrough.md), `Status: ready-for-agent`. Its "Implementer defaults" (walkthrough id, step wording, the exact commands and completion events) are NOT approved by the user.
- Terms: [GLOSSARY.md](../GLOSSARY.md) (no change in this slice). Decisions: [0001](../docs/decisions/0001-hyperspace-works-by-area-not-by-agent.md), [0002](../docs/decisions/0002-hyperspace-writes-user-settings-and-restores-exactly.md), [0003](../docs/decisions/0003-hyperspace-never-reads-or-reopens-layout-state.md). The walkthrough follows 0001 (vendor-neutral); no new record.
- Earlier specs (merged): [phase-2-hyperspace.md](specs/phase-2-hyperspace.md), [phase-2-saved-layout.md](specs/phase-2-saved-layout.md).
- Review findings: [Review outcome and open finding](#review-outcome-and-open-finding) below.

## Git state

- Branch: `feat/walkthrough`. Explicit slice baseline: `3399db6` (`feat: add saved layout (choose and restore agent containers) (#7)`), the parent of `e7cccfc`. Local `main` remains at `75a1920`; use the explicit slice baseline for comparisons.
- HEAD: `e7cccfc` (`feat: add first-run walkthrough`). The previous handoff reports an existing `origin` and an unpushed branch with no PR; these remote claims were not independently verified.
- Uncommitted: this handoff file only. Branch, HEAD, parent and local `main` were checked by Codex. No commit, fetch, push or PR action was taken.

## What was built (see the code and spec)

`contributes.walkthroughs` in [package.json](../packages/towelwise/package.json): one walkthrough, six steps (agents, arrange, choose, restore, hyperspace, settings). Steps 3 to 5 complete on their `onCommand:` events; the others on `onStepSelected`. It names no agent. [media/walkthrough.md](../packages/towelwise/media/walkthrough.md) is a short shared markdown file: VS Code's step schema requires `media` on every step, so the spec's "plain text, no new files" assumption did not hold (recorded in the spec). Tests: [walkthrough.test.ts](../packages/towelwise/src/test/walkthrough.test.ts), a manifest check (the approved seam). No source code changed.

## Review outcome and open finding

Codex used `code-review` at `C:/Users/thisi/.agents/skills/code-review/SKILL.md`. Scope: `3399db6...e7cccfc`, all five changed files, plus Claude's uncommitted handoff update, against the active spec. No production behavior defect found. Implementation and test files were left unchanged.

1. **P2 — Required buttons can break without failing tests.** [walkthrough.test.ts](../packages/towelwise/src/test/walkthrough.test.ts):31 checks only commands it finds in descriptions. Removing the Choose Layout button or redirecting it to the registered Restore Layout command leaves all five walkthrough tests passing. The completion-event loop at line 48 also accepts missing events on the other steps. Assert each required button's expected command and arguments, and the expected completion events for every step. This is an open test-coverage finding, not a demonstrated defect in the current buttons.
2. **P3 — Handoff misidentified local `main` (corrected here).** The earlier handoff called `3399db6` the current local `main`, but the ref is `75a1920`. The slice baseline itself was correct. Git state above now distinguishes them so a later assistant does not include earlier slices by comparing against stale `main`.

Evidence for P2: an in-memory Node probe loaded `out/test/walkthrough.test.js` with a stand-in VS Code extension manifest and command registry. Each independent mutation (Choose button redirected to Restore, Choose button removed, Settings completion event removed) still passed all five tests. No files were edited by the probe; this checks test sensitivity, not real UI behavior.

## Verification actually run

Codex independently ran these from the repo root on Windows at `e7cccfc`, 2026-10-30:

| Command | Exit | Result |
| --- | --- | --- |
| `npm.cmd run lint` | 0 | passed |
| `npm.cmd run build` | 0 | compiled |
| `npm.cmd test` (outside sandbox) | 0 | 30 passing on VS Code 1.144.0 |
| `npm.cmd run package` | 0 | produced `packages/towelwise/towelwise.vsix`, including `extension/media/walkthrough.md` |
| `git diff --check 3399db6...HEAD` | 0 | passed |
| In-memory Node mutation probe | 0 | all five walkthrough tests passed for each broken-manifest variant described above |

Claude's earlier handoff separately reports the same four npm checks passing, with 30 tests, and says the five walkthrough tests failed before the contribution existed. Codex did not recreate that initial red state. **CI has not been verified; the previous handoff reports no CI run on this branch.** Use `npm.cmd` in PowerShell; VS Code tests were run outside the sandbox because earlier launches hit Windows ACL restrictions.

The build installed in the user's VS Code is the saved-layout build from `43b2972`, which has no walkthrough. After any VSIX install, windows must be reloaded or they keep the old manifest.

## Approval and verification gaps

- Walkthrough id, title, step wording, shared Markdown media and exact commands/completion events are implementer defaults still awaiting approval in the spec. Buttons use `workbench.view.extensions` and `workbench.action.openSettings` with the argument `["towelwise"]`.
- Whether `onStepSelected` and `onCommand:` events behave as the spec describes in a real window (not exercised).

## Manual checks still pending

- Walkthrough (needs the user, a build installed, and windows reloaded): open Help > Welcome > Get Started with Towelwise; read all six steps; click each button; confirm steps 3 to 5 tick when run. Wording and appearance are not automated and have not been seen by anyone.
- Carried from saved layout (unchecked): restore in another project; startup apply after a reload; startup apply while hyperspace hides a side bar (the "hyperspace wins" rule). Carried from hyperspace: full screen (`towelwise.hyperspace.fullScreen`) engaging and exiting, and reload recovery with it. The user confirmed choose/restore, the single-agent hyperspace round trip, and multi-window restore.
- Not checked anywhere: CI for this branch, macOS, the VS Code 1.90 floor.

## Open items carried forward

- A whole-repo ponytail audit (2026-10-30, delivered in chat, no saved file) found no must-fix items. Should fix: (1) a failed jump leaves hyperspace marked on, so the next key press silently restores nothing (fix: roll back in `toggle` if `jump` throws, and update the failure tests); (2) `Ctrl+Alt+H` and `Ctrl+Alt+L` can clash with AltGr typing on some keyboard layouts, to be decided before any public release; (3) `chooseLayout`/`discoverContainers` ordering has no test. Nice to have: split locking into its own file; remove the dead default fallbacks in `hyperspace.ts`; skip startup apply work when the setting is off; add a package README and `repository` field before a first release; add `permissions: contents: read` to CI; note Settings Sync in decision 0002. None is requested yet.
- Hyperspace known limits: a crash between a successful full-screen toggle and recording it leaves a full-screen window restore does not know about (F11 fixes it); PID reuse can delay lock recovery up to one hour; crashes can leave ignored `hyperspace.tmp.*` files.
- Not written into AGENTS.md (offered, not requested): reload windows after installing a VSIX.
- Bootstrap defaults (package path `packages/towelwise/`, `engines.vscode ^1.90.0`, CI Node 22 on `ubuntu-latest`, packaging flags) were flagged in the Phase 1 review and never explicitly approved.
- Not authorized by this handoff: pushing, opening a PR, publishing, installing a VSIX. Each is a separate request.

## Smallest next action

Review is complete; the smallest implementation follow-up, when requested, is to strengthen the manifest tests for the P2 finding and have the change reviewed. Defaults and manual walkthrough checks remain pending. Push/open a PR only when separately requested; check CI then. After this slice, the next roadmap slice is slice 4 (named layouts), which needs its own grilling and spec.

Suggested skills: `code-review` for the review; `tdd` for any fix; `diagnosing-bugs` if a manual check fails; `grill-with-docs` then `to-spec` for the next slice; `handoff` when transferring again. Discover skills in the receiving host; do not assume availability.
