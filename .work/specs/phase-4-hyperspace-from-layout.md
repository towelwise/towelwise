# Phase 4, slice 4: Hyperspace reads My layout

Status: ready-for-agent (scope agreed with the owner in a grilling session, 2026-11-05; Codex's review findings 1 to 3 resolved the same day, and the four defaults at the end approved by the owner). Terms follow [GLOSSARY.md](../../GLOSSARY.md), which was updated for this slice (**In use**, **Layout**, **Hyperspace layout**, **Hyperspace**).

## Goal

Hyperspace recognises the person's saved layout. The areas that layout puts something in are **in use**: hyperspace never hides them, and sizes them as the layout says. The areas it leaves empty, and the chrome, are the person's Hide or Keep choices. The Edit Hyperspace Layout picker shows which is which.

This replaces ROADMAP Phase 4 item 3 ("Locked hyperspace"). The owner dropped it on 2026-11-05: hyperspace already keeps what the person chose and hides the rest, so a lock that blocks anything from reopening, the notification and the hovering window are not needed. It also answers the roadmap's open question "does today's layout merge into the hyperspace layout, or stay separate?": the hyperspace layout is built on the layout.

## Approved decisions (owner, 2026-11-05)

- **In use.** An area is in use when the saved layout puts an agent in it (`towelwise.layout.agents`: `left` or `right` mapped to the primary or secondary side bar by `workbench.sideBar.location`, or `panel`). The editor area is always in use. In-use areas are not hideable; the picker shows them locked with the reason (for example "Codex lives here"). Areas the layout does not use, and all chrome, stay Hide or Keep choices. The chrome is not described by the layout.
- **One source for sizes and grid.** When a layout is saved, hyperspace applies `towelwise.layout.sizes` and `towelwise.layout.grid` to what it keeps. It has no sizes or grid of its own then.
- **Hyperspace does not apply the layout.** A jump does not run Restore Layout and does not open anything. An in-use area that is closed when the person jumps stays closed. Restore Layout stays the one command that opens and places things. [0003](../../docs/decisions/0003-hyperspace-never-reads-or-reopens-layout-state.md) is unchanged: hyperspace never reopens an area.
- **No saved layout.** Hyperspace behaves exactly as today: every area is hideable, and `towelwise.hyperspace.sizes` and `towelwise.hyperspace.editorGrid` still apply. Once a layout is saved, the new rules take over. A layout counts as saved by the test Restore Layout already uses (`layoutInUse` in `myLayout.ts`: agents, a grid or sizes saved).
- **No core patch.** The layout bridge already reads part visibility and sets sizes (0003 amendment). Nothing in core changes.

## Acceptance criteria

1. **Which areas are in use.** A pure function takes the parsed saved layout and which side the primary side bar is on, and returns, for each of the three parts (`sidebar`, `auxiliarybar`, `panel`), the agents that live there. It reuses `locationFor` in `myLayout.ts`. A part with no agents is not in use. With no saved layout, nothing is in use. The editor area is not a part here: it is never hideable and has no switch. (Name it so it cannot be confused with `layoutInUse`, which means "a layout is saved".)
2. **Jump skips in-use areas.** With a saved layout, a jump never closes an area that is in use, whatever the stored `hidePrimarySideBar`, `hideSecondarySideBar` or `hideBottomPanel` value says. The stored value is left as it is. Areas not in use, and chrome, are hidden or kept as the settings say, as today. Full screen is unchanged.
3. **Jump applies the layout's sizes and grid.** With a saved layout, a jump applies `towelwise.layout.sizes` (same rules as the hyperspace sizes today: only kept, visible parts; a turned panel is skipped and reported; the 20 percent editor floor) and then the proportions of `towelwise.layout.grid` (proportions only; it never opens, closes or moves a tab, and leaves the grid alone if its shape no longer matches). `towelwise.hyperspace.sizes` and `towelwise.hyperspace.editorGrid` are ignored, and the log says so once per jump. With no saved layout, the hyperspace settings apply as today.
4. **Restore is unchanged.** The snapshot still records sizes and the grid before any change, and Restore puts them back under the same rules as today (only the jumping window, only parts still visible, areas hyperspace closed stay closed). Crash recovery, the lock files and the snapshot format do not change.
5. **The picker shows in-use areas locked.** With a saved layout, each in-use area in Edit Hyperspace Layout is shown as Keep and cannot be changed, with the reason naming the agents that live there. Areas not in use are Hide or Keep as before. Save never writes a hide value for an in-use area. If an area becomes in use after the person chose Hide, their earlier choice is kept in the setting and applies again if the area stops being in use.
6. **The picker's sizes and grid sections defer to the layout.** With a saved layout, the picker replaces its Sizes and Editor grid sections with a note that they come from the layout and are changed in Choose Layout (with a button that runs it). Their stored values are not touched. With no saved layout, the sections work exactly as today.
7. **The picker never writes Hide for an in-use area, even if the layout changes mid-Save.** The picker reads the layout when it opens. Save reads it again immediately before each area's hide value is written, and skips (and reports) an area that is in use at that moment. Save writes its values one at a time with awaits between them (`saveNow` in `picker.ts`), so a layout saved in another window can land between two writes. A check at Save entry alone would miss that. The check and the protected write therefore run under the cross-window lock layout saves already use (`saveLayoutSettings` in `layoutPanel.ts`), or an equivalent guarantee that a layout save cannot interleave. If the lock is busy, Save fails with the same retry message the layout page gives.
8. **Works without the bridge.** Without the bridge (plain VS Code, the test host), jumps work as before and nothing throws. In-use areas are still not hidden.
9. **Docs.** `ROADMAP.md` drops Phase 4 item 3 and the "Next is locked hyperspace" line, records this slice, and marks the "does today's layout merge" question answered. `README.md` drops the "Still ahead for the layout editor: locking hyperspace so nothing else opens while it is on" line (currently line 28), and any README text that says hyperspace has its own sizes or editor grid is corrected. A search for "lock" across the README files and the roadmap finds no remaining promise of locked hyperspace.
10. Everything else behaves as before: chrome hiding, full screen, Choose Layout, Restore Layout, startup apply and drift detection, the shells and the Towelwise menu. Root `npm run lint`, `npm run build`, `npm test` and `npm run package` exit 0.

## Verification

Existing test conventions: the stand-in host in `hyperspace.test.ts`, the picker session in `picker.test.ts`, `myLayout.test.ts` for the layout helpers. The new public boundary is the pure in-use function (criterion 1). Proposed here once, tested directly.

- **Tests (extension host):**
  - The in-use function: agents on the left and right with the side bar on each side, an agent on the panel, no agents, a grid-only or sizes-only layout (nothing in use), two agents in one area (both named), no saved layout.
  - A jump and restore against the stand-in host: an in-use area with its hide value on is not closed and its value is left unchanged; an unused area is hidden; chrome is hidden as before; the layout's sizes and grid are applied and the hyperspace ones ignored (and logged); with no saved layout, the hyperspace sizes and editor grid apply as today; a closed in-use area stays closed; restore is identical to today.
  - The picker session: an in-use area shows locked with its reason and cannot be set to Hide; Save writes nothing for it; a stored Hide is kept; an unused area still toggles; the Sizes and Editor grid sections are replaced by the note with a layout and work as today without one; the layout changing between open and Save; and the interleaving case (criterion 7): Hide is queued for an unused panel along with a chrome change, the stand-in layout then saves an agent into the panel while Save is awaiting the chrome write, and the panel's Hide is not written.
  - No bridge: criterion 8.
- **Package and build checks:** root `npm run lint`, `npm run build`, `npm test` and `npm run package`, each with its exit status recorded.
- **Manual checks in the built app, by the owner**, after a rebuild the owner chooses a time for (a full app build is heavy, per AGENTS.md): save a layout with Codex on the right and Claude Code in a column; open Edit Hyperspace Layout and see the right side bar locked with "Codex lives here", the editor area not a switch, the bottom panel and chrome choosable, and the Sizes and Editor grid sections replaced by the note; jump and see the layout's sizes and grid; restore; change the layout so the bottom panel holds an agent and see the panel locked; clear the layout and see today's picker and behaviour. The mock window in the picker may need a design pass; the owner judges it here.

## Out of scope

- Locked hyperspace in any form: blocking things from reopening, the notification, the hovering window. Dropped, not postponed.
- Hyperspace applying or opening the layout on a jump, and reopening areas on restore (a new decision under 0003 if ever wanted).
- A hyperspace-only size or grid that differs from the layout.
- Editing the layout from the hyperspace picker, or putting chrome into the layout.
- Deleting the legacy hyperspace sizes and grid settings and their code (see the defaults below).
- The first-run screen, the "more agents" list, and every other Phase 4 item.

## Unresolved

None. The one open point, the old hyperspace settings, was decided on 2026-11-05 (see the defaults below).

## Defaults approved by the owner (2026-11-05, after Codex's review)

1. **The old hyperspace sizes and grid are kept as the no-layout path, not deleted.** The grilling session had said both "the separate settings are deleted" and "with no saved layout the old sizes settings still work". The owner chose to keep them as the fallback. Deleting them waits until the owner says (the way the old Choose Layout quick pick was left in place).
2. **A stored Hide on an in-use area is left alone, not cleared**, so the choice returns if the area stops being used.
3. **The picker's note** says the sizes and grid come from the layout and offers a button that runs Choose Layout. The exact wording and the locked-area look are the implementer's, shown to the owner in the built app.
4. **A layout with no agents placed** (grid or sizes only) puts nothing in use among the side areas, so all three stay Hide or Keep choices.

Known consequence, accepted: protection follows where the layout says an agent lives, not where its view is right now. An agent moved by hand after the layout was saved can still be hidden where it actually sits, until the layout is saved or restored again. Live reconciliation is not part of this slice.
