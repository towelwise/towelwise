# Hyperspace hides the palette box and layout buttons

Status: ready-for-agent

## Goal

An extension-only follow-up to [Phase 2 slice 1](phase-2-hyperspace.md), shipped inside the IDE as part of the built-in extension. On the first build of Towelwise AI, true full screen hid the taskbar but left two title-bar items on screen: the palette box and the layout buttons. Hiding both with their VS Code settings gave the result the owner wanted ("what I imagined hyperspace to look like"). This makes hyperspace do that itself, with an on/off option for each, instead of the owner editing settings by hand.

This is not the layout editor. Hover boxes drawn on the live window need a core workbench patch and belong to Phase 4 of [ROADMAP.md](../../ROADMAP.md).

## Acceptance criteria

1. Two new chrome items join the activity bar, status bar and menu bar in hyperspace: the palette box (`window.commandCenter`, hidden when `false`) and the layout buttons (`workbench.layoutControl.enabled`, hidden when `false`).
2. Each has its own on/off setting in the "Towelwise: Hyperspace" group, on by default. Turning one off leaves that item as it was during the next jump.
3. Jump, restore, the saved copy, the exact-restore rule (an unset setting is unset again), the workspace-setting message, and crash recovery work for both items exactly as they do for the existing chrome items. No new mechanism is added.
4. The Command Palette still opens with its keybinding while the palette box is hidden. This needs no code, and the manual check records it.
5. The phase 2 hyperspace spec's lists of chrome items and defaults (criteria 2 to 4) are updated to name the two new items.
6. Root `npm run lint`, `npm run build`, `npm test` and `npm run package` exit 0, and CI passes on the PR.

## Approved decisions

- The owner chose "level 1 plus the picker" on 2026-11-01: this slice (two items) now, and an extension-only visual picker as a second slice with its own spec. The picker is not in this spec.
- The owner's reaction to the manual test: hiding both items gave the intended result.
- Carried from earlier work and not reopened: hyperspace is one shared state across windows, writes user settings only, never opens areas, and keeps the editor area ([0002](../../docs/decisions/0002-hyperspace-writes-user-settings-and-restores-exactly.md), [0003](../../docs/decisions/0003-hyperspace-never-reads-or-reopens-layout-state.md)). Full screen stays an opt-in setting, off by default.

## Verification

- **Public boundary:** the existing hyperspace test file, using the same configuration and command stand-ins it uses today. Add a test that a jump hides both new items and a restore puts both back, one that an unset value returns to unset, and one that turning an item's option off leaves it alone. The boundary is already agreed.
- **Manifest:** the existing manifest test pins each new setting's default and scope.
- **Package and build:** the four root commands in criterion 6.
- **Manual (the owner, built app):** start from a clean state. First restore any existing hyperspace session, so the first command exercises the new jump and not an old saved copy. Then remove the two hand-added lines (`window.commandCenter`, `workbench.layoutControl.enabled`) from the app's user settings, so the unset-to-default round trip is tested; this step is local to the manual check. Rebuild the app with `ide/build.sh` and start it windowed with hyperspace inactive, because the full-screen toggle is blind and would otherwise invert. Jump with full screen on, confirm the palette box and layout buttons are gone and return on restore, and that `Ctrl+Shift+P` still opens the palette.
- **Test list (existing hyperspace tests):** add both keys to the tests' key list and cleanup; cover set and unset restoration, each option off independently, and a workspace override of a new key. Extend `extension.test.ts` for the two new options' defaults. Like the existing hyperspace options, the new ones omit `scope` and inherit window scope.

## Implementer defaults (approved by the owner, 2026-11-01)

- Both new items hide by default, matching what the owner chose in the manual test.
- Option names `towelwise.hyperspace.hideCommandCenter` and `towelwise.hyperspace.hideLayoutControls`.
- Keep the existing `CHROME` table in `hyperspace.ts` (fields `option`, `key`, `hidden`) and add two rows. Do not restructure it. A shared schema and labels are decided with the picker.

## Out of scope

- The visual picker (a clickable mock of the window in Choose Layout), the hover-box layout editor, and proportions. See the unresolved question below.
- Other title-bar and editor items (title bar visibility, editor tabs, breadcrumbs, minimap). Not examined yet.
- Changing the full-screen default.

## Unresolved / external prerequisites

- The picker is specified separately in [phase-3-hyperspace-picker.md](phase-3-hyperspace-picker.md).
- Whether other items should join the chrome table, once the owner points at what else they want gone.
- Seeing the change needs an app rebuild (about 14 minutes on the owner's machine, measured 2026-10-31), because the extension is built in.
