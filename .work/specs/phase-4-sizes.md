# Phase 4, slice 1: Hyperspace sizes

Status: ready-for-agent (scope agreed with the owner, 2026-11-03, grilling session; revised after Codex's review the same day, decisions A to F). Implementer defaults below are proposed, not approved.

## Goal

The first slice of Phase 4 in [ROADMAP.md](../../ROADMAP.md): the person sets the widths and heights of the side areas once, and every jump into hyperspace applies them. Leaving hyperspace puts the sizes back. An extension cannot read or set sizes ([0003](../../docs/decisions/0003-hyperspace-never-reads-or-reopens-layout-state.md)), so a small core patch exposes the layout service's own functions as commands, and the built-in extension does the rest ([0005](../../docs/decisions/0005-patch-core-only-when-the-extension-cannot.md)). Terms follow [GLOSSARY.md](../../GLOSSARY.md).

## Approved decisions (owner, 2026-11-03)

- Sizes are the first Phase 4 slice. Editor-grid layouts come next, then locked hyperspace.
- The patch is a **bridge**: commands that read whether a part is visible, read its size, and set its size. No feature logic in core.
- Three parts get a size: the primary side bar's width, the secondary side bar's width, and the bottom panel's height (its width when the panel sits left or right). The editor area takes what is left. The activity bar, status bar and title bar keep their fixed sizes.
- Sizes are set in the Edit Hyperspace Layout picker with **Use current sizes**, which reads the live window and saves proportions of it. Each size also shows as a percentage that can be typed over.
- A jump records the window's current sizes, and leaving hyperspace puts them back. Only sizes: areas that hyperspace closed still stay closed on restore (0003 is unchanged for that).

## Approved after Codex's review (owner, 2026-11-03)

- **A. Windows.** "Window" means a main workbench window. In the pinned source the side bar, secondary side bar and panel are main-window-only parts (`SINGLE_WINDOW_PARTS`), and `getSize`/`setSize` act on the main window's grid. Each main window has its own extension host, so a bridge command always reaches the window it was called from. A floating (auxiliary) editor window has no side bars; its sizes belong to its main window. A jump in one main window sizes only that window.
- **B. The panel.** The bridge returns the panel's position and the window's size with the part sizes. A saved panel size records its orientation: across (panel left or right, so its width) or down (panel top or bottom, so its height). If the panel's orientation differs at jump time, its size is left alone and the person is told. The same applies on restore if the panel turned while in hyperspace.
- **C. Restore.** Only parts still visible at restore time get their size back. VS Code's own size limits may adjust a size; the result is logged, not treated as a failure. A missing or unreadable snapshot skips sizes, and the settings restore still runs.
- **D. Ranges.** Use current sizes saves what it reads, with no range check. Typed values must be 5 to 80 percent, and the two side bars together must leave at least 20 percent of the width for the editor; a breach is refused on Save with a message. At jump time sizes are applied as saved and VS Code's limits decide the rest.
- **E. Security.** The bridge reads sizes and sets three of them. Any extension can already resize these parts with the built-in increase and decrease commands, so the risk is low. The leading underscore keeps the commands out of the palette; it is not an access boundary.
- **Clarifications of A to D after Codex's re-review (2026-11-03), within the approved decisions:**
  - *Snapshot cases (C).* Size data is an optional part of the one hyperspace snapshot. If the snapshot is valid but its size data is absent or does not fit, sizes are skipped and the settings restore runs. If the whole snapshot is missing, hyperspace is not on and there is nothing to restore. If the whole snapshot is unreadable, the existing behaviour stands: it is cleared, nothing is restored, and the person is told; no old value is ever invented.
  - *Sizes are best effort.* A size that cannot be read or set (the bridge throws or is missing) never stops or undoes a jump or a restore. On a jump, a failed read of the current sizes means the snapshot is published without size data; a failed write is logged and the remaining parts are still tried. On restore, a failed write is logged, the settings restore still completes, and the snapshot is removed as usual. The existing rollback of a failed jump covers settings and full screen only, as now.
  - *Captured and typed values (D).* The draft marks each size as captured (filled by Use current sizes) or typed (changed by hand since). Save checks only typed values against 5 to 80, and applies the 20 percent editor floor only when at least one side-bar width is typed. Editing one captured value makes that one typed; the other stays captured.
- **F. Decision 0003** gets an amendment: layout can be read through the bridge for sizes; the rule never to reopen areas stays.

## Acceptance criteria

1. **The bridge patch.** A new core patch registers commands that return, for the main window the command was called from (decision A), whether each of the three parts is visible and its size in pixels, the panel's position, and the window's size; and that set one part's size along its one sizing dimension (the panel's by its position, as the core's own `resizePart` does). The commands are internal: not in the Command Palette, no shortcuts. The patch is small, applies cleanly to the pinned release, and has its note and upkeep entry in [ide/patches/README.md](../../ide/patches/README.md).
2. **Use current sizes.** In the picker, the button reads the live sizes and fills the three sizes as percentages of the window: the side bars against the window width, and the panel against the width or the height by its orientation, which is saved with it (decision B). A part that is not visible right now cannot be read, so it keeps its previous value and the picker says so. Captured values are saved as read, with no range check (decision D).
3. **Typed percentages.** Each size can be typed. Typed values that are non-numeric or outside 5 to 80, and side-bar widths that together leave less than 20 percent of the width when at least one of them is typed, are refused on Save with a message; captured values pass unchecked (decision D and its clarification), and nothing is written until Save, following the picker's existing rules. A size can also be cleared, meaning hyperspace leaves that part's size alone.
4. **Jump applies sizes.** On a jump, for each part that hyperspace keeps and that is visible, the saved proportion is converted to pixels for the current window and set. Parts hyperspace hides, parts not visible, parts with no saved size, and a panel whose orientation differs from the saved one (the person is told) are left alone. Only the main window that jumped is sized (decision A). Hiding and settings behave exactly as before.
5. **Leave restores sizes.** The jump records the pixel sizes of the visible parts, and the panel's orientation, before changing anything. Restore sets them back in the window that jumped, only for parts still visible at that moment and not for a panel that turned (decision C). A restore from another window, or after a reload, leaves sizes alone (the same rule as full screen in 0003), and areas that hyperspace closed stay closed. Sizes the grid adjusts are logged, not reported as failures. Size data that is absent or does not fit in an otherwise valid snapshot skips sizes while the settings restore still runs; a wholly unreadable snapshot keeps today's behaviour (see the clarifications). A failed size read or write never stops or undoes a jump or restore.
6. **Works without the bridge.** Without the bridge (plain VS Code, such as the test host), the size controls say that sizes need Towelwise AI, jumps work as before, and nothing throws.
7. Everything else behaves as before: hyperspace, the picker's Keep and Hide, Choose Layout, Restore Layout, the shells and the Towelwise menu. Root `npm run lint`, `npm run build`, `npm test` and `npm run package` exit 0, and the full IDE build succeeds.

## Verification

- Tests (extension host): the proportion-to-pixel conversion and back, with rounding, for the panel in both orientations; validation of typed percentages, including the 20 percent editor floor, and Save with captured values outside the typed rules, with one captured value edited and the other kept; a jump and restore against a stand-in bridge (sizes applied only to kept, visible parts; restore only in the jumping window and only to parts still visible; a panel that changed orientation between save, jump and restore is skipped and reported; adjusted sizes are logged; a valid snapshot with absent or bad size data skips sizes but restores settings; a wholly unreadable snapshot behaves as today; a bridge that throws on read during a jump publishes a snapshot without sizes; a bridge that throws on write during a jump or restore is logged, the other parts are still tried, and settings restore and snapshot removal still happen); behaviour with no bridge (criterion 6); the manifest schema of the new setting.
- Built app, by the owner: drag the side bars and panel, open the picker, press Use current sizes and Save; change the sizes by hand; jump and see the saved sizes; leave and see the hand-set sizes back; reload during hyperspace, leave, and see sizes left alone; move the panel to the right and jump (its size is skipped with a message); with a floating editor window open, jump from the main window and see only the main window sized; jump from inside the floating window (for example by its shortcut while it has focus) and see its main window sized; with two main windows open, jump in one and see the other's sizes untouched, then restore from the other window and see sizes left alone. These window checks are what decision A relies on; if any fails, stop and report before going further.

## Implementer defaults (proposed; flag in review)

- Command ids `_towelwise.layout.state` and `_towelwise.layout.setSize` (the leading underscore keeps them out of the palette), with part names `sidebar`, `auxiliarybar` and `panel`, matching the core's `Parts` enum.
- One setting, `towelwise.hyperspace.sizes`, an object with the two side-bar proportions and the panel's proportion plus its orientation (proportions 0 to 1, any may be absent), with the same scope as the `towelwise.hyperspace.hide*` settings. A hand-edited value that does not fit is ignored part by part and logged.
- The pre-jump pixel sizes and the panel's orientation live in the existing hyperspace snapshot file, beside the full-screen record, with the window that jumped. A snapshot from the previous version, which has no sizes, still restores (the existing compatibility test is extended).

## Out of scope

- Editor-grid layouts (the next slice) and locked hyperspace.
- Reopening areas on restore, or any other change to 0003 beyond sizes.
- Pixel-exact or per-monitor sizes, and named layouts.

## Unresolved

- Whether `setSize` gives exactly the requested size, or the layout grid adjusts it (minimum sizes, neighbouring parts). The spike checks it in the built app and records what it found.
