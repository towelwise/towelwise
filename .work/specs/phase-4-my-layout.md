# Phase 4, slice 3: My layout (choose agents, build the grid, restore it)

Status: ready-for-agent (scope and the three open points approved by the owner, 2026-11-03). Replaces the "use what is already open" approach of [the editor-grid spec](phase-4-editor-grid.md), which proved not to be what the owner wants. Works under [0005](../../docs/decisions/0005-patch-core-only-when-the-extension-cannot.md) as amended on 2026-11-03 (layout is core product, and gets the patches it needs). Terms follow [GLOSSARY.md](../../GLOSSARY.md).

## Goal

The person designs their window once, Towelwise puts everything where they said, and keeps it there. Three parts:

1. **Choose Layout.** A guided setup: pick which agents to use and where each lives (left side bar, right side bar, bottom panel, or a column of the editor grid); build the editor grid (columns and rows) and say what each cell holds.
2. **Restore Layout.** A command that re-applies the saved layout at any time. The saved layout is the source of truth: dragging things around never changes it unless the person says so.
3. **Keeping it.** The saved layout applies when a window opens. If the live window drifts from it (the person resized or moved things), Towelwise offers to save the new arrangement or put the saved one back.

This is separate from the hyperspace layout (which things to keep or hide while focusing). Hyperspace is untouched by this slice.

## What the probes established (2026-11-03, stock VS Code, Claude Code 2.1.317, Codex 26.1021)

- A side view moved with VS Code's own move-view call stays there after a reload, and the agent's own open command opens it in the new place. Only the picker-free way to make the move is missing: a bridge command.
- Claude Code's editor tab opens in a new column it picks itself. Moving the tab into a chosen cell works and the conversation survives. Codex opens its tab (a custom editor) in the focused column, so focusing the cell first places it with no move. A terminal opens straight into a cell with `createTerminal({ location: { viewColumn } })`.
- VS Code closes a column when its last tab leaves it, and the cell numbers shift. A planned cell that has never held a tab stays open when empty. So placement must hold the target cell by reference (not by number), and only ever move a tab out of a column that was not planned.
- Cell order: the editor groups' view columns run in grid reading order (left to right, top to bottom within a column). Confirmed on a three-column grid with the third split in two.
- Not yet confirmed: whether a Codex conversation survives being moved between cells. The design avoids moving Codex.

## The flow

**Choose Layout** (command `Towelwise: Choose Layout`, also in the Towelwise menu) opens one picker page, like the hyperspace picker, in three steps:

1. **Choose agents.** A list with a check box for each of Claude Code and Codex (more agents later, see Out of scope). An agent not checked is left alone.
2. **Where does each live?** For each checked agent, four icon choices, using VS Code's own layout icons: left side bar, right side bar, bottom panel, or a column (a cell of the editor grid). The icon for "left" and "right" follows `workbench.sideBar.location`, so "left" always means the left of the screen. Terminal is offered here too, for a cell only: the bottom panel's terminal is VS Code's own and needs no placement.
3. **Build the editor grid.** Shown only if something is placed in a column. It starts as two equal columns. The person can add a column at the left or right edge, split a column into rows, remove a column or row, and drag the splitters to set proportions. (First version, decided while building slice B: columns that split into rows, which covers the owner's three-column example; columns inside rows are a later step. A saved grid that is deeper or turned the other way is kept exactly as it is, with a note, and only Start over replaces it.) Each cell takes one item (an agent set to "column", or a terminal) or stays empty. Every agent set to "column" must be in exactly one cell.

The same page holds the side bar and panel sizes (typed percentages or **Use current sizes**, reusing the hyperspace sizes section) and shows the result as a mock window.

**Save** writes the layout to the user's settings. The page then says it was saved and how to see it: *Run Developer: Reload Window (Ctrl+R), or press Restore Layout now to apply it without reloading.* A button does either.

**Restore Layout** (command `Towelwise: Restore Layout`) applies the saved layout to the window it runs in. With no saved layout it says so and offers Choose Layout.

## The existing saved layout (Phase 2) and how this fits

Phase 2 already ships `Towelwise: Choose Layout` (a quick pick of container ids), `Towelwise: Restore Layout`, and the settings `towelwise.layout.containers`, `towelwise.layout.commands` and `towelwise.layout.applyOnStartup` (default off), in `src/layout.ts`. My layout replaces Choose Layout with the page described here and extends Restore Layout. So that nobody loses what they have:

- **Settings are siblings, not one object**, because `towelwise.layout` cannot be both an object setting and the parent of `containers`: `towelwise.layout.agents`, `towelwise.layout.grid` and `towelwise.layout.sizes`.
- **Legacy stays working.** If none of `towelwise.layout.agents`, `.grid` and `.sizes` holds anything, Restore Layout and the startup apply behave exactly as today (show the saved `containers`, run the saved `commands`). Once any of the three is saved, the new apply runs instead and `containers` and `commands` are ignored (logged once). (The trigger was `agents` alone in the first draft; changed after review, because a layout of a terminal-only grid, or sizes alone, would otherwise be saved by the page and silently not applied.) Choose Layout opens the new page; there is no migration of the old lists. The old quick-pick (`chooseLayout` in `layout.ts`) is no longer reachable from the command and is left in place, unused, until the owner says to delete it.
- **`applyOnStartup` keeps its name**; the owner chose default on, so its default changes from false to true. For a legacy layout the startup apply stays containers-only and quiet, as today. For the new layout it is the full apply of this spec.

## The saved layout

Three settings, each an object with the same scope as the other `towelwise.*` layout settings; a value that does not fit is ignored as a whole and logged:

- `towelwise.layout.agents`: `{ "claudeCode": "column", "codex": "right" }`, each `left | right | panel | column`. (`column` was called `editor` in the first draft and in slice A's first build; renamed 2026-11-03 at the owner's request, because it means a column Towelwise controls, not the editor area, which VS Code always has.)
- `towelwise.layout.grid`: `{ "orientation": 0, "groups": [ { "size": 0.5, "holds": "claudeCode" }, ... ] }`.
- `towelwise.layout.sizes`: the same shape as `towelwise.hyperspace.sizes` (`sidebar`, `auxiliarybar`, `panel`, `panelOrientation`).

- `grid` and `sizes` use the shapes already built (`SavedGrid`, `Sizes`); a grid leaf carries `holds` (`claudeCode`, `codex`, `terminal`) instead of the old display label, or nothing for an empty cell.
- Rules checked on parse: an agent placed in a column appears in exactly one leaf; an agent placed elsewhere appears in none; `terminal` may appear in several leaves.

## Applying a layout (Restore Layout, and window start)

Best effort throughout: one step failing is logged and reported at the end, and never stops the next. Nothing is ever closed, and no tab other than the chosen items is moved.

1. **Skip conditions.** If hyperspace is active in this window (a snapshot exists), do not apply on startup, and refuse Restore Layout with a message (leave hyperspace first).
2. **Side views.** For each agent set to left, right or panel: ask the bridge which container holds its view and move it to the wanted place, then open it with the agent's own command (`claude-vscode.sidebar.open`, `chatgpt.openSidebar`). The agent's possible container ids are listed in the extension (Claude Code: `claude-sidebar-secondary`, `claude-sidebar`; Codex: `codexSecondaryViewContainer`, `codexViewContainer`) and the first one the bridge finds is used. The bridge knows a container by the id core gives it, the manifest id with the prefix `workbench.view.extension.` (found in the first built-app check, 2026-11-03: asking with the bare id found nothing).
   **Also open as an editor tab.** If the agent is placed in a side bar or the panel and one of its editor tabs is open (Claude Code's webview or Codex's `chatgpt.conversationEditor`, recognised by the agent registry), nothing is closed. The result reports it ("Claude Code is also open as an editor tab") with a **Close it** button; pressing it closes that tab only. Owner decision, 2026-11-03: report and offer, not close automatically, because a tab can hold an unsent draft. Done with the grid work in slice B, which brings the tab recognition into the registry.
3. **Grid shape.** If a grid is saved: `vscode.setEditorLayout` with the saved shape and proportions. Existing tabs stay in their groups when the shape matches; when it does not, VS Code folds removed groups' tabs into their neighbours and closes none.
4. **Cell contents**, for each leaf that holds something, in reading order, holding the target group by reference:
   - **Claude Code:** if its tab is already open in another cell, move it to this one. Otherwise open it (`claude-vscode.editor.open`), wait for its tab (up to 15 seconds), then move it to this cell. The column Claude Code adds for itself closes when its tab leaves.
   - **Codex:** if its tab is open elsewhere, move it. Otherwise focus the cell and run `chatgpt.newCodexPanel`; check where it landed and move it only if it landed elsewhere.
   - **Terminal:** if the cell already has a terminal tab (with its name, when it has a chosen one), leave it. Otherwise, if a terminal with that name is in another group that is not a cell wanting the same terminal, move it in (found 2026-11-05: after a reload VS Code brings terminals back in the groups it remembers, one off from the grid, so opening a new one doubled them). A cell saved without a choice of terminal is filled by whatever terminal it holds, and its terminal is never taken for another cell. A revived terminal's name comes back a moment after its tab (empty until then), so before creating one, Restore waits up to 5 seconds for such names and looks again. Otherwise `createTerminal` into the cell.
   - A tab is moved by making it the active tab of its group and running `moveActiveEditor` to the target's position, recomputed at move time from the live groups.
   - **Empty groups are held open while this runs.** VS Code closes a group when its last tab leaves, which would shift the grid and, with an agent alone in a planned group, loop on repeated restores (found in review). So Restore turns `workbench.editor.closeEmptyGroups` off in the user's settings for the duration and puts it back exactly as it was (no value if there was none), then closes only the empty groups that are not cells of the grid (the one Claude Code opens for itself). If a project overrides the setting, it is left alone and a column that closes is reported.
5. **Sizes**, last: side bar and panel sizes through the bridge's `setSize` (same planning and 20% editor floor as hyperspace sizes).
6. **Report.** A short message only if something could not be placed (for example "Codex did not open"), with the details in the Towelwise output channel.

## Keeping it: drift detection

VS Code has no resize event for the editor grid, so Towelwise compares live state with the saved layout when the window gains focus and every 30 seconds while focused (cheap: one read of the main window's grid, one bridge read of the sizes). With the bridge the grid comes from `_towelwise.layout.mainLayout`, the main window's grid whichever window is active (a floating editor window can be open and focused). Without it (stock VS Code) the grid comes from `getEditorLayout`, which answers for the active window, and is kept only when it holds every editor group there is, counted after the read, so it can only be the main window's; the sizes need the bridge and are then left out.

- **Drift** is: the grid's shape differs from the saved one, any proportion differs from saved by more than 3% of its parent, or a side bar or panel size differs by more than 3 points of the window.
- On drift, one notification (not modal): **Your layout has changed since you saved it.** Buttons: **Save this layout**, **Restore saved layout**, **Not now**. *Not now* silences the prompt until the live state changes again or the window reloads; the saved layout then applies at the next window start.
- **Save this layout** captures the live grid proportions and sizes, keeping each cell's `holds` and each agent's place. If the shape itself differs (a column added or removed), it cannot know what the new cells hold, so the button becomes **Edit layout…** and opens Choose Layout with the live shape.
- Never prompts while hyperspace is active, while Choose Layout is open, while an apply is running, or in a window that has no saved layout.
- Moving an agent to another side bar is not detected in this slice (see Out of scope); it is corrected at the next apply.
- *Not now* (and the baseline taken after an apply) silences only what it measured. A part it could not read then (the grid in stock VS Code with a floating window open, a hidden side bar) does not stay silent once it can be read: if it has drifted from the saved layout, the prompt is shown.

## The core patch (extension of 0003, new in this slice)

Added to the existing layout bridge patch, not a new patch. Underscore command names as for the others (kept out of the palette; not an access boundary):

- `_towelwise.layout.locate(containerId)` returns `'sidebar' | 'auxiliarybar' | 'panel'` or undefined (unknown container), from `IViewDescriptorService.getViewContainerLocation`.
- `_towelwise.layout.moveContainer(containerId, location)` calls `IViewDescriptorService.moveViewContainerToLocation(container, location, undefined, 'towelwise')`, the call VS Code's own drag and drop makes. Returns false if the container does not exist or cannot move.

- `_towelwise.layout.mainLayout()` (slice C) returns `IEditorGroupsService.mainPart.getLayout()`: the main window's editor grid in the shape `vscode.getEditorLayout` returns for the active window.

The patch README gets the new commands and upkeep rows as for 0003. Needs a full IDE build and the owner's built-app check.

## Implementation slices

Each is spec-checked, built test-first, reviewed by Codex and checked by the owner before the next:

- **A. Placement of side views.** The patch additions, the agent registry (container ids, open commands) in the extension, and a first **Restore Layout** that does steps 1, 2 and 5 only. Needs a full build. The owner's check: choose left/right/panel for each agent through the settings value, run Restore Layout, reload.
- **B. Choose Layout and the grid.** The picker page (steps 1 to 3, sizes, Save, the reload message), the `towelwise.layout.agents`, `.grid` and `.sizes` settings, and apply steps 3 and 4. Extension only.
- **C. Keeping it.** Apply on window start and drift detection with its prompt. Extension, plus one more bridge command, `_towelwise.layout.mainLayout` (added 2026-11-05 so the grid can be read while a floating editor window is open and focused; amends 0003 in place and needs the next full build and the owner's built-app check). The extension still works without it.

## What carries over from the editor-grid slice, and what does not

- **Carries over:** `grid.ts` (parse, proportions, shape, readback difference), `sizes.ts` and the bridge's `state` and `setSize`, the Draft and queue pattern in `picker.ts`, the stand-in hosts in the tests, and the read-back logging of adjusted proportions.
- **Changes:** a grid leaf's `label` becomes `holds`; the tab-kind recognition in `liveGridEnv` (Claude Code webview, Codex custom editor, terminal) moves into the agent registry and is used for finding existing tabs.
- **Stays as built for now:** the hyperspace editor-grid slice (jump applies saved proportions, leave puts them back, the picker's Editor grid section). See Unresolved.

## Acceptance criteria

1. **Choose.** The page offers Claude Code and Codex, four places each with icons that follow the side bar setting, Terminal as a cell item, the grid builder, sizes and Save. A layout that breaks the parse rules cannot be saved and says why.
2. **Grid builder.** Starts as two equal columns. Add column left/right, split a column or row, remove one, drag splitters (each cell at least 10%). The mock matches what Restore Layout produces.
3. **Save.** Writes the three layout settings and shows the reload message with a Reload Window button and a Restore Layout button. Nothing is written until Save.
4. **Restore Layout.** Applies steps 2 to 5 in a window that has things open or nothing open. Running it twice leaves the same result (nothing opened twice, no new empty columns).
5. **Never destructive.** No tab is closed. Tabs that are not a chosen item are not moved except where VS Code folds a removed group's tabs on a shape change.
6. **Start.** A new window applies the saved layout once after its editors have restored, unless `applyOnStartup` is false or hyperspace is active.
7. **Drift.** Changing a proportion more than the tolerance shows the prompt once; the three buttons do what is described; *Not now* stays quiet until the state changes again. With a floating editor window open and focused, the main window's grid is still compared (with the bridge).
8. **Best effort.** Any step failing is logged and reported; the rest still run. A malformed setting is ignored and logged.
9. **No second copy.** An agent placed in a side bar or the panel that is also open as an editor tab is reported with a **Close it** button; nothing closes unless it is pressed.
10. **Hyperspace unaffected.** Jump and restore behave as before; no drift prompt or startup apply during hyperspace.
11. Root `npm run lint`, `npm run build`, `npm test` and `npm run package` exit 0, at the current VS Code and at 1.90.0 (the extension runs there without the bridge: moving and sizes are then skipped with a log line, and the grid steps still work). Slice A is also built into the IDE and checked by the owner.

## Verification

- Tests (extension host), against stand-in hosts: parse rules (agent in one leaf, `holds` values, malformed value); the apply order and its skip conditions; holding a cell by reference when the agent adds a column (the stand-in reproduces the shifted numbers from the probe); an agent already open being moved, not reopened; a second apply opening nothing; each step failing alone; drift (within and beyond tolerance, shape change, silencing); no prompt during hyperspace; the picker's draft rules and the queue.
- Built app, by the owner: slice A as above; then the whole flow: choose both agents and a terminal, build three columns with the third split, Save, reload and see the layout, drag things, see the drift prompt, take each button, close everything and press Restore Layout.

## Out of scope

- A bottom panel under a single editor column (0005 amendment: a terminal in a cell covers it).
- More agents than Claude Code and Codex; a "more agents" list is a later slice.
- Detecting an agent moved to another side bar, and named layouts (several saved layouts).
- Moving a Codex conversation between cells (not needed; unconfirmed).
- Locked hyperspace, and the first-run screen.

## Decided by the owner (2026-11-03)

1. **The hyperspace editor grid** stays as built for now. The owner has looked at it; whether hyperspace should later reuse the My layout grid is decided after My layout is in use.
2. **After accepting the drift prompt, no reload is offered.** Save this layout makes the saved layout equal to what is on screen, so there is nothing to reload. A reload matters only after Not now, when the saved layout comes back at the next window start.
3. **The layout applies whenever a window opens**, switchable with `towelwise.layout.applyOnStartup` (default true).
