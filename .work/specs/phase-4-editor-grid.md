# Phase 4, slice 2: Editor-grid proportions

Status: ready-for-agent (scope agreed with the owner, 2026-11-03; the implementer defaults below were approved by the owner on 2026-11-03). One unresolved check (below) comes first.

## Goal

Roadmap item 5a in [ROADMAP.md](../../ROADMAP.md): the person arranges the editor area in VS Code the way they like (several columns and rows, with agents, a terminal or a dashboard in the cells), saves that, and every jump into hyperspace re-applies the columns' and rows' proportions. Leaving hyperspace puts the previous proportions back. No core patch is expected: `vscode.getEditorLayout` and `vscode.setEditorLayout` are built-in commands. Terms follow [GLOSSARY.md](../../GLOSSARY.md). Follows [the sizes spec](phase-4-sizes.md) and [0005](../../docs/decisions/0005-patch-core-only-when-the-extension-cannot.md).

## Approved decisions (owner, 2026-11-03)

- The person builds the grid themselves with VS Code's own drag and drop, then saves it with a **Use current layout** button, the same pattern as Use current sizes. The picker has no grid designer of its own.
- Scope is **applying a saved layout to what is already open**: the saved grid's proportions are re-applied on a jump. Rebuilding a layout from nothing (opening agents and moving their tabs into cells) is out of this slice.
- Claude Code chats living in a side bar rather than the editor area are a separate question for later; this slice only concerns the editor area.

## Probe findings (2026-11-03, throwaway probe, not in the repo)

- `vscode.setEditorLayout` applied nested columns and rows with the proportions asked for. `vscode.getEditorLayout` returns the same shape with sizes in pixels (siblings sum to the container's size).
- The tab-groups API identifies tabs by type: Claude Code is a webview (view type ending `claudeVSCodePanel`), Codex a custom editor (`chatgpt.conversationEditor`), a terminal `terminal`.
- A terminal in the editor and a text editor open in the focused group. Claude Code's editor command opens beside it (splitting it), and Codex landed in another group than the focused one. After a reload every tab came back, but not all in the same groups. So opening agents into chosen groups is unreliable, which is why this slice does not do it.

## Implementer defaults (approved by the owner, 2026-11-03)

- **Saved with the other sizes.** The grid is part of the same hyperspace layout: the same picker page, the same Save, and a setting `towelwise.hyperspace.editorGrid` beside `towelwise.hyperspace.sizes`, with the same scope as the other `towelwise.hyperspace.*` settings.
- **What is saved:** the grid's shape (nested columns and rows, no sizes) and each group's proportion of its parent (0 to 1), plus a label per cell naming what it held when captured (the tab type of its active tab: "Claude Code", "Codex", "Terminal", or the file name), for the picker's mock only.
- **Shape rule.** On a jump the live grid's shape is compared with the saved one (same orientation and the same nested number of groups, ignoring sizes). If it matches, the proportions are applied. If not, the editor grid is left alone and the person is told, as with the panel's side in the sizes spec. What the cells hold plays no part in the comparison.
- **Restore.** The jump records the live grid's shape and proportions before changing anything; leaving puts them back only in the window that jumped and only if the shape still matches. Best effort, as for sizes: a failed read or apply is logged and never stops a jump or a restore.
- **Order.** Side bar and panel sizes are applied first, then the editor grid, so the grid proportions apply to the editor area's final size. Proportions, not pixels, so it does not depend on the window size.
- **Window.** The same rule as decision A in the sizes spec: a main window's commands act on that window's own grid, and a restore from another window or after a reload leaves the grid alone.

## Acceptance criteria

1. **Capture.** In the picker, **Use current layout** reads the live editor grid (`vscode.getEditorLayout`), turns pixel sizes into proportions of the parent, and fills the draft with the shape, the proportions and a label per cell. Nothing is written until Save. A grid with a single group is saved as "one group" and applies nothing.
2. **Show.** The picker shows the saved grid as a small mock (nested boxes sized by the proportions, each labelled), and a **Clear** button that removes the saved grid so hyperspace leaves the editor grid alone. Without a grid, the mock says none is saved.
3. **Typed proportions.** Not offered: the grid is captured, not typed. (Proportions can be hand-edited in settings; a value that does not fit is ignored as a whole and logged.)
4. **Jump applies.** After side bar and panel sizes are applied, if the setting is valid and the live shape matches, the proportions are applied with `vscode.setEditorLayout`. If the shape differs, nothing is applied and the person is told once. No tab is opened, closed or moved. Hiding and settings behave as before.
5. **Leave restores.** The jump records the live grid before changing it. Leaving re-applies those proportions in the window that jumped if the shape still matches; otherwise it is left alone. A restore from another window or after a reload leaves the grid alone. Absent or unfit grid data in a valid snapshot skips the grid while settings and sizes still restore.
6. **Works without a grid.** With no saved grid, the jump does not call the layout commands for applying, but still records the live grid so leaving can restore a grid the jump changed (nothing else changes it, so this is a safeguard, logged only if it differs).
7. **Best effort.** A failed read or apply of the grid never stops or undoes a jump or restore; it is logged.
8. Everything else behaves as before. Root `npm run lint`, `npm run build`, `npm test` and `npm run package` exit 0. No full IDE build is needed (no core patch), but the owner checks it in the built app.

## Verification

- Tests (extension host): pixel-to-proportion conversion of nested layouts (including uneven and nested rows); shape comparison (same, different count, different orientation, nested difference); parsing a hand-edited setting (whole value ignored if invalid); a jump and restore against a stand-in editor layout (applied only on a shape match, order after sizes, a mismatch skipped and reported, restore only in the jumping window and only on a shape match, a read or apply that throws is logged and everything else completes, a snapshot without grid data still restores); Use current layout and Clear in the draft; no layout commands called when there is no saved grid; the manifest schema of the new setting.
- Built app, by the owner: arrange three columns with the third split into two rows and Claude Code, Codex, a terminal in the editor and another editor in the cells; press Use current layout and Save; drag the splitters somewhere else; jump and see the saved proportions; leave and see the dragged proportions back; close a column and jump (the grid is left alone with a message); reload during hyperspace and leave (the grid is left alone).

## Out of scope

- Rebuilding a layout from nothing: opening agents or terminals into chosen groups and moving tabs into cells (the probe found the agents' open commands do not respect the focused group). A later slice if daily use needs it.
- Claude Code chats in a side bar, and named layouts.
- A grid designer inside the picker, and typing group proportions.
- Locked hyperspace.

## Unresolved

- Whether `setEditorLayout` with the same shape leaves every tab in its group when the groups are filled (the probe applied it only to an empty window). Checked first in the built app or a probe, before the rest of the slice is relied on.
- Whether a group's size can be exactly the proportion saved, or the grid adjusts it (minimum editor sizes); logged, not a failure, as for sizes.
