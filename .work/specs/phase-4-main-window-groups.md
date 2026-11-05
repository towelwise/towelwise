# Phase 4: Restore places only in the main window's editor groups

Status: ready-for-agent (the core patch additions approved by the owner, 2026-11-04; the focus-main-window approach chosen by the owner after Codex's review). Builds on [My layout](phase-4-my-layout.md) and [Cell terminals](phase-4-cell-terminals.md). Works under [0005](../../docs/decisions/0005-patch-core-only-when-the-extension-cannot.md).

## Goal

Restore Layout works while another editor window is open: the Choose Layout page's own window, or any floating editor window. Today it counts every window's groups, so it reports "the editor grid has 4 groups after it was set, not 3" and places nothing.

## What is established (2026-11-04)

- Seen in the built app: with the Choose Layout window open, Restore failed with that message for a 3-cell grid. With it closed, the same Restore placed both terminals correctly.
- `vscode.window.tabGroups.all` covers every window, and the extension API cannot tell which window a group is in. [liveEditors.ts](../../packages/towelwise/src/liveEditors.ts) counts and numbers all of them.
- In Code-OSS (`editorParts.ts`, `getGroups`), groups across windows are listed part by part, main window first (`part.ts`: parts kept in insertion order, main part first). View columns follow that order, so the main window's groups are view columns 1 to N, where N is the main part's group count.
- **Corrected after Codex's review:** `vscode.setEditorLayout` acts on the **active** editor window, not always the main one (`editorCommands.ts` calls `applyLayout`, which `editorParts.ts` hands to `activePart`, and `part.ts` picks the part whose document has focus). The commands Restore uses to focus groups and move tabs act on the active window too. So with a floating window active, Restore would reshape and fill that window. Counting only the main window's groups is not enough on its own.
- The core's host service can focus a given window (`IHostService.focus(window, { mode })`), and `activePart` then follows the focused window.

## The change

1. **Core bridge (patch 0003 additions):**
   - `_towelwise.layout.mainGroupCount`: the main editor part's group count. Read-only.
   - `_towelwise.layout.focusMain`: focuses the main window (`IHostService.focus(mainWindow, { mode: Force })`) and its active editor group, then waits briefly (up to about 1 s) until the main part is the active part. Returns true once it is, or false if it never becomes active.
2. **Extension, Restore:** before anything else in the editor grid (before the grid is set), Restore calls `focusMain`. If it returns false, the editor grid is not touched and Restore reports "the main window could not be brought to the front, so the editor grid was left alone; click the main window and run Restore Layout again". Side bar placement and sizes still run, since they are main-window parts anyway.
3. **Extension, groups:** `liveEditors` uses only the first N groups (view column order), with N from the bridge. N is the main window's own count, not a count of the other windows' groups: a floating window that closes during a restore then changes nothing, where a cached count of the others would drop a main group and let cleanup close a planned cell (Codex's second review). A group an agent opens for itself in the main window raises N, and that is read from the bridge's fresh main count when the agent's tab opens, never inferred from the total of all windows' groups: a floating window closing at the same moment cancels that total out (Codex's third review). Placement, the group registry and the empty-group cleanup only ever see main-window groups, so nothing in another window is moved, closed or counted.
4. Without the bridge (stock VS Code), both steps are skipped and behaviour is unchanged.
5. Restore run from a floating window brings the main window to the front. That is expected: it is where the layout is.

## Acceptance criteria

1. With the Choose Layout window open, Restore Layout places every cell in the main window and reports no group-count problem.
2. With another floating editor window open (a file moved to a new window), the same holds, and nothing in that window is moved or closed.
3. With a floating window **active**, Restore run from it (palette or keybinding) brings the main window to the front, then sets and fills the main window's grid. The floating window's own groups keep their shape and contents, including when its grid differs from the layout's and when the layout holds only terminals.
4. If the main window cannot be made active, the editor grid is left alone and that is reported; nothing in any window is reshaped.
5. With no other window, Restore behaves exactly as before.
6. In stock VS Code (no bridge commands), behaviour is unchanged.

## Verification

- Unit tests through the existing seams: `Editors.groups()` returning only the main window's groups when a count is given, and all of them when it is not; `applyLayout` calling `focusMain` before the grid is set, and leaving the grid alone (with the report) when it returns false; no call without the bridge.
- Extension-host test (stock VS Code, so without the bridge): a floating window's groups are ignored by `liveEditors.groups()` when a count is given.
- Extension-host test: with the main count read, closing the floating window changes neither the groups listed nor the handles held for them (checked to fail with the earlier cached-others approach). A second one: the floating window closes and an agent opens a new main group, and every handle held for the main groups is the same object afterwards (checked to fail with total-based detection).
- `npm run lint`, `npm run build`, `npm test`, and `VSCODE_TEST_VERSION=1.90.0 npm test`.
- Patch check: the patch applies to the pinned Code-OSS, and the full build succeeds (owner's go-ahead needed).
- Built-app check: criteria 1 to 3, using Codex's regression: a floating file window active with a different grid shape from the layout's, a terminal-only layout, and Restore run from the floating window's palette.

## Out of scope

Placing agents or terminals in other windows. Restoring a layout inside the Choose Layout window. The remaining Choose Layout window limitations (the 300 ms focus wait, an empty auxiliary group left on closing).

## Unresolved questions

- Whether the earlier split seen beside Git Bash in the main window was caused by the open Choose Layout window. Not reproduced in stock VS Code; recheck in the built app after this fix.
