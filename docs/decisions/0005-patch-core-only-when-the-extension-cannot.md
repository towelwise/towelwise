# Change the IDE through the built-in extension first, and patch core only when it cannot reach

Status: superseded by [0007](0007-towelwise-ai-is-a-fork-of-code-oss.md) (2026-11-06). Was approved by the owner (2026-11-02). Refines [0004](0004-towelwise-ai-is-an-ide-built-from-code-oss-patches.md), which stays as written.

0004 chose a small patch set on upstream Code-OSS and said core patches are "few and careful", but did not say when a change belongs in the built-in extension and when it needs a patch. Work since then showed where the line falls. The owner expects more menu changes (the first is the Terminal menu) and more edits that an extension cannot make, and wants the extension to go first because it means fewer patches.

**What the extension could not do, found in practice (2026-11-02)**

- Add to, or hide items in, the top-level menus. Extensions can contribute to only a few menus (the terminal's right-click menus, one copy-and-paste submenu, the Command Palette); the top **Terminal** menu is not among them.
- Measure or draw over the live window, which a box overlay needs.
- Set exact widths and heights.
- Hide or remove built-in areas.

**What a patch showed us.** A patch spike (layout mode, built and dropped on 2026-11-02) proved the mechanism: VSCodium applies every `patches/user/*.patch` after its own, our patch applied without error on the pinned release, and a patched build took about 14 minutes. The cost of keeping a patch across a real upstream update is still unmeasured; that is Phase 3 criterion 7.

**The rule**

1. If the public extension API can do it, it goes in the built-in extension.
2. If it cannot, make the smallest patch that makes it possible: new files plus a one-line registration where that works, with the logic kept in the extension so it can be tested.
3. Prefer one configurable hook over many one-off patches. For menus, that means a single patch that lets the extension or a config file say which menu entries to hide and which to add, so later menu changes are data, not new core code. This is a plan, not a proven design: adding items is easy, hiding another feature's items may need a different method, so it is spiked before anything depends on it.
4. Every patch carries a short note: why it exists, what it touches, and, at each upstream update, whether it needed changes and how long that took. Those notes are what the upkeep measurement is made of.
5. Hide before delete (see the strip-down section of [ROADMAP.md](../../ROADMAP.md)): removing the way in costs little; deleting code touches every file that imports it.

**Ruled out**

- **One patch per change.** Each is another thing to re-base on every upstream release.
- **Extension only.** The limits above are real, and the product's layout and strip-down goals need some of them.
- **A full fork** (already ruled out in 0004).

**Consequences**

- The first patch is likely the menu hook, because the Terminal change needs it.
- A patch that grows beyond a few small files is a signal to stop and ask whether the extension, or a smaller patch, can do the job.
- Patches are tested by the build and by the owner in the built app. Logic they rely on stays in the extension, where automated tests reach it.

**Revisit** if the first real upstream update shows the patch upkeep is too high, if the menu hook cannot hide entries cleanly, or if so many things need patches that the extension is no longer where most of the code lives.

## Amendment (owner, 2026-11-03): the layout is core product, and gets the patches it needs

The owner defines the first release as "your layout, your way, plus hyperspace". After the editor-grid slice was built, they found that applying proportions to whatever is already open does not produce the layout they want. The layout has to be something the user designs and Towelwise places: which agent lives where (left side bar, right side bar, bottom panel, or a cell in the editor grid), the grid itself, and a saved layout that Restore Layout can always bring back. That is the product's main difference from other editors, so it is worth more core patching than rule 2's "smallest patch" allows.

**What changes for layout work**

- Layout features may patch core wherever the extension cannot do the job reliably. They are not limited to new files plus a one-line registration. A patch that grows past a few small files no longer has to stop and ask (the consequence above). It still needs a note on why the extension cannot do the job.
- Rules 1, 4 and 5 still apply. The extension goes first where the public API is enough, every patch keeps its upkeep note, and features are hidden before they are deleted. Logic stays in the extension where it can be tested, and core patches stay bridges and hooks wherever that works.
- Rule 3 extends to layout. Bridges belong on the existing layout bridge patch (0003), not in new one-off patches.

**What the agents' code showed (2026-11-03).** Claude Code and Codex only declare where their side views start (both ask for the right side bar). After that, VS Code core decides where a view lives and remembers moves (`IViewDescriptorService.moveViewToLocation`, the same call that dragging a view uses). The only built-in command for this, **View: Move View**, is an interactive picker, so Towelwise needs a bridge to move a view without the picker. Claude Code chooses its own editor column when it opens a tab and ignores the focused group. Towelwise therefore places it after it opens, or, if that loses the conversation, a patch steers where it opens.

**Expected patches, in order of need, each settled by a probe first**

1. Move a view container to a side bar or the panel (added to the layout bridge). Small.
2. Steer an agent's editor tab into its assigned cell. Needed only if moving the tab after it opens loses the conversation.
3. A bottom panel that sits under a single editor column. Not planned: a terminal tab in a grid cell gives the same result without reworking the workbench layout. It is reconsidered only if that falls short in use.

**Probe results (owner, 2026-11-03, stock VS Code with Claude Code 2.1.317 and Codex 26.1021)**

- **Side views:** a view moved with View: Move View stayed where it was put after a reload. The agent's own open command (Open Codex Sidebar, Claude Code: Open in Side Bar) opened it in the new place. Patch 1 is confirmed as needed and enough. It only makes that move without the picker.
- **Agent tabs:** Claude Code opens its tab in a new column of its own choosing. Towelwise can move the tab into its cell and the conversation survives. Codex opens its tab (a custom editor, `chatgpt.conversationEditor`) in the focused column, so focusing the cell first places it with no move. Patch 2 is not needed. Not yet confirmed: whether a Codex conversation survives a move, because its chat did not load during the probe.
- **Terminals:** `createTerminal` with an editor location opened each terminal straight into the cell it asked for.
- **Empty cells:** VS Code closes a column once its last tab leaves it (`workbench.editor.closeEmptyGroups`), and the grid shifts. Placement must never leave a planned cell empty, or must handle that setting.

**Unchanged:** [0003](0003-hyperspace-never-reads-or-reopens-layout-state.md) still governs hyperspace. Hyperspace never reopens areas it closed. The saved layout and Restore Layout are a separate feature that may open and place things, because that is what the user asks for when they press it.

**Revisit** after the first real upstream update, with the layout patches' upkeep measured. If one release's rebase of the layout patches takes more than a day, look again at what can move back into the extension.
