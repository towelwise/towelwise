# Phase 2 slice 1: Jump to hyperspace

Status: ready-for-agent

## Goal

First slice of ROADMAP.md Phase 2 ("First prototype: Towelwise"), reordered on 2026-10-29 so hyperspace comes first and agent buttons are dropped. One command hides the chrome and areas a person chose, leaving their agent panels in view; the same command restores every setting it changed exactly. Terms follow [GLOSSARY.md](../../GLOSSARY.md).

The person has already arranged their agents. Example (the user's own layout): Antigravity in the primary side bar, Claude Code in the editor area, Codex in the secondary side bar.

## Acceptance criteria

1. A command **Towelwise: Jump to Hyperspace** exists in the Command Palette and has a default keybinding. Hyperspace is one shared state across all VS Code windows: running the command in any window while hyperspace is off jumps; running it in any window while hyperspace is on restores.
2. In hyperspace, every chrome item marked "hide" is hidden, and every hideable area marked "hide" (primary side bar, secondary side bar, bottom panel) is closed in the window that jumped. The editor area is always kept, because VS Code only offers a blind toggle for it. Areas marked "keep" are left as they were: hyperspace never opens a kept area that was closed and never moves or closes agent panels.
3. Defaults: keep primary side bar and secondary side bar; hide activity bar, status bar, menu bar and bottom panel. The editor area is always kept.
4. Each chrome item and each hideable area has an on/off setting in a "Towelwise: Hyperspace" settings group. Changing them changes what the next jump hides.
5. On the first jump, Towelwise saves the previous user-settings value of every setting it will change, including "not set", exactly once. While hyperspace is on, that saved copy is never overwritten, from any window. A jump or restore runs one at a time across all windows: a command that arrives while another is in progress is ignored. The saved copy is published atomically, and a saved copy that cannot be read is cleared with an explanatory error instead of blocking later toggles. After restore, each of those settings matches its saved value exactly (an unset setting is unset again, not written as its default).
6. Restore does not reopen areas that hyperspace closed; they stay closed until the person reopens them. (VS Code gives extensions no way to read whether an area was open.)
7. If a workspace or folder setting keeps a chrome item visible, so the user setting cannot hide it, hyperspace still hides everything else and shows one quiet message naming the blocking setting. Towelwise never writes workspace or folder settings.
8. If VS Code reloads or crashes while in hyperspace, the next window to start shows a quiet offer to restore. Accepting it restores per criterion 5. Nothing restores without the person acting.
9. Root `npm run lint`, `npm run build`, `npm test` and `npm run package` exit 0, and CI passes on the PR.

## Approved decisions (user, 2026-10-29)

From the grilling session:

- Hyperspace first; the "sidebar with agent buttons" slice is dropped from the roadmap.
- Trigger: a command plus a default keybinding. No sidebar, status bar item or other Towelwise UI.
- Model: by area, not by agent. No agent list or vendor detection in this slice, so any agent works, including Antigravity.
- Settings scope: write user (global) settings and restore them exactly. Accepted side effect: other open VS Code windows also lose the hidden bars while in hyperspace.
- Choices live in VS Code settings now. A guided first-run setup belongs to the roadmap's beginner-profile slice.
- After reload/crash: remember the hyperspace state and offer restore; never restore automatically.

Resolving Codex's spec review (findings in `.work/HANDOFF.md`):

- Areas hyperspace closes stay closed on restore; the exact-restore guarantee covers settings only.
- Workspace/folder overrides: hide the rest and name the blocking setting; never write workspace settings.
- Multiple windows: one shared hyperspace; the first jump's saved values cannot be overwritten; any window's command restores.
- Test seam: the approved round trip, extended with set, unset and workspace-override cases. Recovery after reload stays manual.

Resolving Codex's commit review of `f1c2e50`:

- Narrowed scope (user, 2026-10-29): the editor area has no hide control and is always kept. No safe way to close it exists, only a toggle that can open it.
- Overlapping commands are serialized by a cross-window lock; an unreadable saved copy is cleared with an error. Both have regression tests at the same round-trip seam.

No decision records yet. The area-based model and the user-settings scope are candidates for the first records in `docs/decisions/`; the user has not yet asked for them.

## Verification

- **Automated (approved seam):** extension tests in a real VS Code test instance. Each records the relevant settings, runs the command to jump, asserts what is hidden, runs it again to restore, and asserts every touched setting equals its recorded value. Cases: (a) all relevant settings unset; (b) one setting already set to a non-default value; (c) a workspace setting keeping one chrome item visible: the others are hidden, the message names it, the workspace setting is untouched, and restore is exact. Use `tdd` for this behaviour.
- **Smoke checks:** lint, build and package exit 0 locally and in CI on the PR.
- **Manual:** after installing the VSIX, jump with the user's real three-agent layout; jump from one window and restore from a second; reload VS Code while in hyperspace, accept the restore offer, and confirm settings are back and the bottom panel stays closed.

## Implementer defaults (not approved; flag in review)

- The default key combination, checked against VS Code's and the installed agents' existing bindings.
- The exact VS Code settings and commands used to hide each chrome item and close each area.
- Setting names, and where the shared saved state is stored (it must be visible to every window).

## Out of scope

- Agent buttons, an agent list, detecting or recognising agents.
- Reopening areas on restore.
- Hiding the editor area.
- Guided first-run setup (beginner-profile slice).
- Saved layouts (slice 2) and reopening lost panels.
- Reserving a place for the Probability Drive (Phase 4).
- Hiding or closing non-agent editor tabs.
- Publishing a release.

## Unresolved / external prerequisites

- Whether every chrome item can be hidden on all platforms (the menu bar behaves differently on macOS). Verified on Windows only unless tested elsewhere.
- Whether the extension tests run headless in CI the way the activation test does.
- If VS Code later adds an API for reading area visibility (upstream microsoft/vscode#283331), reopening areas on restore can be revisited.
