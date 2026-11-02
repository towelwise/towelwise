# Phase 4, slice 1: Layout mode

Status: ready-for-agent

## Goal

The first slice of Phase 4 in [ROADMAP.md](../../ROADMAP.md) and the first core patch of Towelwise AI ([decision 0004](../../docs/decisions/0004-towelwise-ai-is-an-ide-built-from-code-oss-patches.md)). On the live window, a visible box sits over each part, and the person turns each part's hyperspace behaviour between Keep and Hide by clicking its box, then saves it as their hyperspace layout. This is the in-window version of the [picker](phase-3-hyperspace-picker.md), which drew a mock window because an extension cannot see or draw over the real one.

This slice is on/off only. Sizes and proportions, locked hyperspace, the first-run screen and the rest of Phase 4 are later slices. Terms follow [GLOSSARY.md](../../GLOSSARY.md).

## Acceptance criteria

1. The build applies our patch. `ide/build.sh` copies `ide/patches/*.patch` into the VSCodium checkout's `patches/user/`, VSCodium's own hook for extra patches, and the app still builds, launches and passes the existing smoke checks. The patch applies cleanly to the pinned release. This slice ends the "no patch of ours" rule of [Phase 3](phase-3-first-build.md) for this one patch only.
2. The command **Towelwise: Layout Mode** is in the Command Palette of the built app and has no default keybinding. Running it enters layout mode in the current window. A second run, or Escape, leaves it as Cancel does.
3. In layout mode a box is drawn over each of these parts of the live window: activity bar, status bar, menu bar, palette box, layout buttons, primary side bar, secondary side bar and bottom panel. Each box shows its name and Keep or Hide, taken from the current value of its `towelwise.hyperspace.hide*` option. The editor area has a box marked "Always kept" that cannot be toggled.
4. A part that is not on screen right now (for example the status bar when it is already hidden by a setting), or one the patch cannot reliably locate (see the layout buttons under the implementer defaults), has no place to draw a box. Such parts appear as boxes in a small strip so they can still be set, and the strip says why they are there.
5. Boxes follow their parts when the window is resized or a part changes size. They never block the person from reaching Save or Cancel.
6. Clicking a box, or pressing Space or Enter on it, switches it between Keep and Hide in a draft. Boxes can be reached by Tab in a sensible order and show a visible focus ring, and focus stays on the same box after the draft changes. Keep means hyperspace leaves the part as it is; Hide means hyperspace hides or closes it on the next jump (the same wording as the picker).
7. A small bar offers **Save**, **Cancel** and the full-screen switch (`towelwise.hyperspace.fullScreen`). Nothing is written until Save. Save follows the picker's rules exactly: only options the person edited, only user settings, one at a time, queued Saves, a partial failure names the failed part and lists what already saved. Cancel and leaving layout mode write nothing.
8. Choosing, saving and cancelling in layout mode never change the live window: no part is hidden, shown, opened, closed or resized by layout mode. Nothing is snapshotted or restored on exit. If the person resizes the window or opens or closes a side bar themselves while in layout mode, those changes stay, as they would anywhere else.
9. The saved result is the same `towelwise.hyperspace.*` options the picker and hyperspace already read. Saving writes the user setting, and the next jump and the picker read the setting that applies. Normally that is exactly what was saved. If a workspace or folder setting overrides an option, the value that applies can differ from what was saved (a saved Hide can still apply as Keep, and the other way round). In that case layout mode marks the box as set by the project, says that saving cannot override it, and shows the value that applies.
10. The patch is a view. It measures parts, draws the boxes, manages focus and the overlay's life, and forwards clicks and Save to the extension through commands. The extension validates each request as an option and value pair: Keep or Hide only for the eight hide options, on or off only for full screen; any other id, or a value that does not match its option, is rejected with no change. Draft transitions, mapping to options, which writes to make, the Save queue and failure handling all live in the extension. The patch only renders the state it is given. Any extension can run these commands, which is acceptable because extensions can already write these settings through the configuration API.
11. The patch is kept small: new files plus a single registration, with its size recorded. Whether it needed changes on the first upstream update is recorded when criterion 7 of Phase 3 runs.
12. Hyperspace, the picker, Choose Layout and Restore Layout behave as before. Root `npm run lint`, `npm run build`, `npm test` and `npm run package` exit 0, and CI passes on the PR.

## Approved decisions (owner, 2026-11-02, grilling session)

- The first slice of the layout editor is layout mode with on/off only. Sizes come in a later slice.
- The layout is saved into the existing `towelwise.hyperspace.*` options: one source of truth shared with the picker and hyperspace. No migration and no new storage.
- The patch is a thin view over the extension. The extension keeps the draft and Save logic.
- Clicking only marks a part Keep or Hide until Save. There is no live preview that hides parts in the real window.
- The picker stays as a separate command, a patch-free fallback. Retiring it is a later decision.
- Test boundary: automated tests cover the extension side (the commands the patch calls, on top of the tested draft). The patch is checked by the build and by the owner in the built app.
- Related decisions, not reopened: [0001](../../docs/decisions/0001-hyperspace-works-by-area-not-by-agent.md), [0002](../../docs/decisions/0002-hyperspace-writes-user-settings-and-restores-exactly.md), [0003](../../docs/decisions/0003-hyperspace-never-reads-or-reopens-layout-state.md), [0004](../../docs/decisions/0004-towelwise-ai-is-an-ide-built-from-code-oss-patches.md).

## Verification

- **Automated (extension, real configuration, same seam as the picker tests):**
  - The commands the patch calls: one that returns the items with their values, one to choose Keep or Hide, one to save, one to cancel.
  - A state request reports the value that applies, and marks an option a project overrides.
  - Choosing writes nothing; Save writes only edited options to user settings; Cancel discards without writing.
  - Overlapping Saves, partial failure and the saved list behave as they do for the picker.
  - The commands reject any option id outside the nine and any value that is not Keep/Hide or on/off.
  - Layout mode and the picker keep separate drafts, and saving in one is visible to the other after it reopens.
  - The manifest adds the command and no keybinding; the existing shortcut test stays unchanged.
- **Build and package:** the patch applies to the pinned VSCodium release and the app builds and launches (smoke checks from Phase 3); the four root commands in criterion 12.
- **Manual (the owner, built app, after a rebuild of about 13 minutes):**
  - Run Layout Mode; boxes sit over the right parts, labelled Keep or Hide.
  - Click, and use Tab and Space, to change several; Cancel changes nothing.
  - Save, then confirm in Settings, in the picker, and by jumping to hyperspace that all three agree.
  - Put a workspace override on one option (for example `hideStatusBar: false` in a project), choose Hide and Save: the box is marked as set by the project, says saving cannot override it, and a jump still follows the project value.
  - Resize the window and open and close a side bar yourself; boxes follow, and your changes are still there after leaving layout mode.
  - With a part already hidden by a setting, find it in the strip.
  - Check box and label contrast in a light and a dark theme.
  - Leave layout mode and confirm the window is unchanged.

## Implementer defaults (not approved; flag in review)

- The command id and the name "Layout Mode" (the id is `towelwise.layoutMode.open`, plus `.state`, `.choose`, `.save`, `.cancel`).
- The patch registers itself with one added line and lives in new files under the workbench's contrib folder. The exact files are the implementer's choice.
- The strip for parts that are not on screen sits along the bottom edge.
- The title-bar items are located inside the title bar by the patch. At the pinned Code-OSS commit the menu bar (`.menubar`, `role=menubar`) and the palette box (`.command-center`) have clear handles. The layout buttons do not: they come from the layout-control menu and share one toolbar with other title-bar actions, so the whole toolbar must not be measured as the layout buttons. Unless the implementer finds a reliable handle for just those buttons, they are shown in the strip, and the build notes record which parts got a box on the window and which went to the strip, before anyone claims every visible part has a box.
- `ide/build.sh` copies `ide/patches/*.patch` into the checkout's `patches/user/` after its reset, clean and checkout steps and before VSCodium prepares the source. Copying earlier would lose the patches to the clean. This is read from the pinned scripts, not yet run.
- The full-screen switch lives in the bar, as it does in the picker.

## Out of scope

- Sizes, widths, heights and proportions; drag to resize; pixel-exact or per-monitor layouts.
- Locked hyperspace, the notification, and the dismissable hovering window.
- The first-run screen, the "more agents" list, and "works for anyone" beyond what the layout already allows.
- Parts that have no `hide*` option today (tabs, breadcrumbs, minimap, the title bar itself); retiring the picker; merging this with Choose Layout; named layouts.
- macOS and Linux; CI for the app build.

## Unresolved / external prerequisites

- Whether the pinned patch pipeline accepts our patch on top of VSCodium's. Only the first build shows this.
- Whether the three title-bar items can be located reliably in the workbench (see defaults). The first build will show.
- The upkeep cost of carrying a patch. Phase 3 criterion 7 (a real upstream update) still waits on a VSCodium 1.144 release.
- Light-theme legibility of the boxes is a visual check only the owner can do.
