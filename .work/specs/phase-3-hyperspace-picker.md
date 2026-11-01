# Edit Hyperspace Layout: a clickable mock of the window

Status: ready-for-agent

## Goal

The second slice after [the title-bar slice](phase-3-hyperspace-title-bar.md), which adds the palette box and layout buttons to what hyperspace hides. This slice lets a person choose what hyperspace hides by clicking parts of a mock window, instead of editing `towelwise.hyperspace.*` settings by hand. It is extension-only. Hover boxes drawn over the live window need a core workbench patch and stay in Phase 4 of [ROADMAP.md](../../ROADMAP.md). Terms follow [GLOSSARY.md](../../GLOSSARY.md): this edits the hyperspace layout, not the layout (the agent panels Restore brings back).

## Acceptance criteria

1. A command **Towelwise: Edit Hyperspace Layout** is in the Command Palette. It has no default keybinding.
2. It opens one panel showing a mock of the window with these items, each marked Keep or Hide: activity bar, status bar, menu bar, palette box, layout buttons, primary side bar, secondary side bar, bottom panel. The panel explains the words: Hide means hyperspace hides or closes it on the next jump; Keep means hyperspace leaves it exactly as it is. Keep never shows an item that is already hidden and never reopens a closed area (decision 0003). The editor area is drawn as always kept and cannot be toggled. A separate full-screen switch sits beside the mock. Running the command again focuses the open panel.
3. Each item starts from the value that currently applies for its option. Hide means the option is on: `towelwise.hyperspace.hideActivityBar`, `hideStatusBar`, `hideMenuBar`, `hideCommandCenter`, `hideLayoutControls`, `hidePrimarySideBar`, `hideSecondarySideBar` and `hideBottomPanel`. The full-screen switch is `towelwise.hyperspace.fullScreen`.
4. Clicking an item changes it in a draft held by the extension. Nothing is written until the person presses **Save**. The draft survives the panel being hidden and shown again (switching to another tab and back) and running the command again to refocus it. It is discarded only by Cancel or by the panel being closed, and neither writes anything.
5. An option counts as edited only if its draft value differs from the value the panel opened with (or last saved). Save compares only the edited options with the user (global) setting and writes those that differ, and nothing else. Consequences: saving with no edits writes nothing; toggling an item and toggling it back writes nothing; and an untouched option keeps its user value exactly, including "not set", even when a workspace or folder value makes a different value apply (the panel must not copy that applied value back into user settings).
6. The picker never writes a setting outside the nine allowed options (the eight hide options and `fullScreen`), never writes a non-boolean value to them, never writes workspace or folder settings, and never changes the live window. The extension, not the page, enforces the allowed keys and boolean values. It does not read or change hyperspace's saved copy, so Restore still returns the person's own settings exactly.
7. Save writes one option at a time and does not promise atomicity. If a write fails, the panel stays open with the draft intact, names the option that failed, and Save can be pressed again; options already written stay written and show as saved. No rollback is attempted.
8. While hyperspace is on, Save still works and the panel says the change applies from the next jump; the current session is unchanged.
9. If a workspace or folder setting overrides an option, the panel shows the value that applies and marks the option as overridden by the project. Save still writes only the user setting.
10. The panel loads nothing from the network, runs only its own script under a content-security policy, and follows VS Code's webview guidance for local content.
11. Root `npm run lint`, `npm run build`, `npm test` and `npm run package` exit 0, and CI passes on the PR.

## Approved decisions (owner, 2026-11-01, grilling session)

- Extension-only. Hover boxes on the live window are the Phase 4 layout editor.
- It opens from a **new command**. Choose Layout stays the agent-panel picker. Whether the two merge is the open Phase 4 question in the roadmap.
- The first version covers exactly the eight hyperspace controls above plus full screen. Tabs, breadcrumbs, minimap and the title bar itself are separate slices later.
- It writes only the `towelwise.hyperspace.*` options, never the live window settings.
- A person clicks until happy, then Save writes the changes. "All at once" means one Save press, not one atomic update (criterion 7).
- Test boundary: a plain logic module tested through real configuration, the same seam as the hyperspace tests. The page itself is not automated and is checked by the owner in the built app.
- Related decisions, not reopened: [0001](../../docs/decisions/0001-hyperspace-works-by-area-not-by-agent.md), [0002](../../docs/decisions/0002-hyperspace-writes-user-settings-and-restores-exactly.md), [0003](../../docs/decisions/0003-hyperspace-never-reads-or-reopens-layout-state.md).

## Verification

- **Automated (the logic module, real configuration, no UI):**
  - The item list reports the value that applies for each option, for defaults, explicitly set values, and a workspace override, and marks overridden ones.
  - The Keep/Hide flip: Hide maps to the option being on, in both directions.
  - Save writes only the edited options that differ from the user setting, to user settings; the others stay as they were, including unset.
  - Save with no edits writes nothing. Toggle-then-revert writes nothing.
  - Edit one option while another has a workspace override: the untouched option's user value survives, whether set or unset.
  - Save writes the full-screen option.
  - Cancel and a closed panel write nothing; the draft is kept across hide/show and refocus.
  - The extension rejects any key outside the nine allowed options and any non-boolean value.
  - A write that fails reports the failing option, keeps the draft, and a second Save writes only what is still unsaved.
  - Saving while hyperspace is on leaves its saved copy untouched, and a later restore returns the person's own settings exactly.
- **Manifest:** the existing manifest test adds that the command is registered and has no keybinding. The existing shortcut test stays unchanged.
- **Build and package:** the four root commands in criterion 11.
- **Manual (the owner, built app):** the page bindings can't be tested by the logic tests, so check each of these.
  - Open the command; toggle items; Cancel and reopen to see nothing changed.
  - Toggle an item, switch to another editor tab and back, and run the command again: the draft is still there. Then close the unsaved panel with its tab's close button and reopen it: the draft is gone and nothing was written.
  - Toggle again and Save; confirm the options changed in Settings; jump and confirm hyperspace now hides what was chosen.
  - Start with an item already hidden (for example `window.commandCenter` off in your settings) or a closed area, choose Keep, and confirm it stays hidden or closed after the jump and the panel's Keep explanation matches.
  - Put a workspace override on one option: the panel marks it, and saving a different option leaves your user value for it alone.
  - Press Save while hyperspace is on: the panel shows the next-jump message and the current session doesn't change.
  - Read the mock in a light and a dark theme.
  - Needs the title-bar slice built in, and an app rebuild of about 14 minutes.

## Implementer defaults (not approved; flag in review)

- Command id `towelwise.hyperspace.edit`; title as in criterion 1.
- The mock is a schematic drawn with VS Code's theme colours, not a screenshot.
- The page says Keep and Hide, not Show and Hide, because Keep is what the option does (Codex review R2). The owner confirmed this wording on 2026-11-01. The logic module owns the flip between Hide and the option being on, so the page never does arithmetic on option names.
- Save writes only edited options whose draft differs from the user setting (criterion 5). It does not write defaults for options the person never touched.
- The draft is held by the extension, not only in the page, so it survives the page being hidden. The persistence mechanism is the implementer's choice.
- No "reset to defaults" button in this version.
- A new `picker.ts` for the logic and a small page under `media/`, following the existing file layout.

## Out of scope

- Hover boxes on the live window, proportions and sizes, locked hyperspace (Phase 4).
- Tabs, breadcrumbs, minimap, the title bar's own visibility, and any new hyperspace behaviour.
- Merging this with Choose Layout, a default keybinding, live preview, and a reset button.
- Browser-driven tests of the page, and macOS and Linux checks.

## Unresolved / external prerequisites

- The final command title and the visual design of the mock.
- The title-bar slice (two new options) must be in the same build; this slice lists them in the mock.
- First use of a webview in this repo: no earlier decision on webview conventions exists, so the criterion 9 wording is the new rule.
