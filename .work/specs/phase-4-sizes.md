# Phase 4, slice 1: Hyperspace sizes

Status: ready-for-agent (scope agreed with the owner, 2026-11-03, grilling session). Implementer defaults below are proposed, not approved.

## Goal

The first slice of Phase 4 in [ROADMAP.md](../../ROADMAP.md): the person sets the widths and heights of the side areas once, and every jump into hyperspace applies them. Leaving hyperspace puts the sizes back. An extension cannot read or set sizes ([0003](../../docs/decisions/0003-hyperspace-never-reads-or-reopens-layout-state.md)), so a small core patch exposes the layout service's own functions as commands, and the built-in extension does the rest ([0005](../../docs/decisions/0005-patch-core-only-when-the-extension-cannot.md)). Terms follow [GLOSSARY.md](../../GLOSSARY.md).

## Approved decisions (owner, 2026-11-03)

- Sizes are the first Phase 4 slice. Editor-grid layouts come next, then locked hyperspace.
- The patch is a **bridge**: commands that read whether a part is visible, read its size, and set its size. No feature logic in core.
- Three parts get a size: the primary side bar's width, the secondary side bar's width, and the bottom panel's height (its width when the panel sits left or right). The editor area takes what is left. The activity bar, status bar and title bar keep their fixed sizes.
- Sizes are set in the Edit Hyperspace Layout picker with **Use current sizes**, which reads the live window and saves proportions of it. Each size also shows as a percentage that can be typed over.
- A jump records the window's current sizes, and leaving hyperspace puts them back. Only sizes: areas that hyperspace closed still stay closed on restore (0003 is unchanged for that).

## Acceptance criteria

1. **The bridge patch.** A new core patch registers commands that return, for the current window, whether each of the three parts is visible and its size in pixels, and that set one part's size. The commands are internal: not in the Command Palette, no shortcuts. The patch is small, applies cleanly to the pinned release, and has its note and upkeep entry in [ide/patches/README.md](../../ide/patches/README.md).
2. **Use current sizes.** In the picker, the button reads the live sizes and fills the three sizes as percentages of the window (width parts against the window width, the panel against the window height). A part that is not visible right now cannot be read, so it keeps its previous value and the picker says so.
3. **Typed percentages.** Each size can be typed. Out-of-range or non-numeric values are refused with a message, and nothing is written until Save, following the picker's existing rules. A size can also be cleared, meaning hyperspace leaves that part's size alone.
4. **Jump applies sizes.** On a jump, for each part that hyperspace keeps and that is visible, the saved proportion is converted to pixels for the current window and set. Parts hyperspace hides, parts not visible, and parts with no saved size are left alone. Hiding and settings behave exactly as before.
5. **Leave restores sizes.** The jump records the pixel sizes of the visible parts before changing anything. Restore sets them back in the window that jumped. A restore from another window, or after a reload, leaves sizes alone (the same rule as full screen in 0003), and areas that hyperspace closed stay closed.
6. **Works without the bridge.** Without the bridge (plain VS Code, such as the test host), the size controls say that sizes need Towelwise AI, jumps work as before, and nothing throws.
7. Everything else behaves as before: hyperspace, the picker's Keep and Hide, Choose Layout, Restore Layout, the shells and the Towelwise menu. Root `npm run lint`, `npm run build`, `npm test` and `npm run package` exit 0, and the full IDE build succeeds.

## Verification

- Tests (extension host): the proportion-to-pixel conversion and back, with rounding and the panel's left/right case; validation of typed percentages; a jump and restore against a stand-in bridge (sizes applied only to kept, visible parts; restore only in the jumping window); behaviour with no bridge (criterion 6); the manifest schema of the new setting.
- Built app, by the owner: drag the side bars and panel, open the picker, press Use current sizes and Save; change the sizes by hand; jump and see the saved sizes; leave and see the hand-set sizes back; reload during hyperspace, leave, and see sizes left alone.

## Implementer defaults (proposed; flag in review)

- Command ids `_towelwise.layout.state` and `_towelwise.layout.setSize` (the leading underscore keeps them out of the palette), with part names `sidebar`, `auxiliarybar` and `panel`, matching the core's `Parts` enum.
- One setting, `towelwise.hyperspace.sizes`, an object of the three proportions (0 to 1, any may be absent), with the same scope as the `towelwise.hyperspace.hide*` settings.
- The pre-jump pixel sizes live in the existing hyperspace snapshot file, beside the full-screen record, with the window that jumped.
- Allowed percentages: 5 to 80 for each part.

## Out of scope

- Editor-grid layouts (the next slice) and locked hyperspace.
- Reopening areas on restore, or any other change to 0003 beyond sizes.
- Pixel-exact or per-monitor sizes, and named layouts.

## Unresolved

- Whether `setSize` gives exactly the requested size, or the layout grid adjusts it (minimum sizes, neighbouring parts). The spike checks it in the built app and records what it found.
