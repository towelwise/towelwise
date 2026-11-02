# Change the IDE through the built-in extension first, and patch core only when it cannot reach

Status: approved by the owner (2026-11-02). Refines [0004](0004-towelwise-ai-is-an-ide-built-from-code-oss-patches.md), which stays as written.

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
