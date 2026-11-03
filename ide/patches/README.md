# Core patches

Towelwise AI changes Code-OSS through its built-in extension first, and patches core only where the extension cannot reach ([decision 0005](../../docs/decisions/0005-patch-core-only-when-the-extension-cannot.md)). `ide/build.sh` copies every `*.patch` here into the VSCodium checkout's `patches/user/`, which VSCodium applies after its own patches. Patches are plain `git apply` diffs against the pinned upstream source.

Each patch has a note below: why it exists, what it touches, and how it fared at each upstream update (the upkeep record 0005 asks for).

## 0001 menu hook (`0001-towelwise-menu-hook.patch`)

**Why.** The owner wants to hide built-in features (the integrated terminal, Tasks, later Debug, Testing and Notebooks) and have a Towelwise menu of its own, without a new patch for each change. Spec: [menu-hook.md](../../.work/specs/menu-hook.md).

**What it does.** Two settings that the built-in extension ships are the whole interface: `towelwise.menus.hidden` (command ids or `prefix.*` patterns to hide) and `towelwise.menus.towelwise` (the entries of a new Towelwise menu). A hidden command is not offered in menus, the Command Palette or default shortcuts, but still runs when called by other code. An entry of the form `menu:MenuId` hides the submenu item that opens that menu (used for the View menu's Appearance and Editor Layout), never the commands inside it; it matches the menu id exactly. Spec: [view-menu.md](../../.work/specs/view-menu.md). The pinned source registers those two submenus only on the View menu, so no other menu loses them.

**What it touches (6 files, one hunk or new file each; +267/-2 lines).**

- new `platform/commands/common/hiddenCommands.ts`: the shared list, its matcher, and a startup default equal to the setting's default so nothing flashes before the setting is read. It also holds `isMenuHidden`; the command matcher skips `menu:` entries so a command that happens to share a menu id is not hidden.
- `platform/actions/common/actions.ts`: `MenuRegistry.getMenuItems` returns its result without hidden commands, after the implicit Command Palette items are added, and drops hidden alternate actions; menus rebuild when the list changes. A submenu item whose menu id is listed as `menu:MenuId` is dropped there too (+2 lines, view-menu slice). The startup default also lists the Debug, Testing and Notebook families (prefixes) and `menu:MenubarDebugMenu`, so the top-level Run menu goes too.
- `platform/keybinding/common/keybindingsRegistry.ts`: default shortcuts of hidden commands are left out (removal rules and user shortcuts are untouched).
- `workbench/services/keybinding/browser/keybindingService.ts`: rebuilds the resolver when the list changes.
- new `workbench/contrib/towelwise/browser/towelwise.contribution.ts`: reads both settings, applies the list and builds the Towelwise menu. Entries keep the array order, and a group name that comes back after another group is a new section (counted by runs, the same rule as `placeEntries` in the extension). The top-level Towelwise item is registered after its entries, and again on every rebuild and whenever a context key that one of the entries' conditions reads changes: the menu bar redraws only when its main menu changes, not when a submenu gains entries, and it drops a submenu with nothing to show without watching the conditions of entries inside it. The settings are also read again once extensions have registered, because on a first launch the contribution runs before the built-in extension's settings exist.
- `workbench/workbench.common.main.ts`: one import, added at the end of the imports, away from the block VSCodium edits.

**Known limits.** Editor actions that the Command Palette reads straight from the active editor are not covered. Typing `term ` in quick open still opens the terminal picker. The built-in JavaScript Debug extension adds its own terminal command.

## 0002 welcome header (`0002-towelwise-welcome-header.patch`)

**Why.** The Welcome page showed VSCodium's subtitle "Editing evolved" and no mark. The subtitle is a string in core code, so an extension cannot change it. The owner chose "Coding Gone Hyper", a nod to Hyperspace mode (a first idea that quoted a film was dropped to stay clear of a studio's property).

**What it touches (2 files, one hunk each; +12/-1 lines).** `welcomeGettingStarted/browser/gettingStarted.ts`: the subtitle text. `welcomeGettingStarted/browser/media/gettingStarted.css`: a `::before` rule that draws the Towelwise mark before the product name. The mark itself is a file overlay, not part of the patch: `ide/build.sh` copies `ide/icons/code-icon.svg` to `towelwise-mark.svg` beside that stylesheet. The faint mark in an empty editor is likewise a file overlay (`ide/icons/letterpress/*.svg` over the four `letterpress-*.svg` files).

**Known limits.** The subtitle keeps its original localization key, so a translated build would still show the translation of "Editing evolved"; Towelwise ships in English only for now. VSCodium already edits `gettingStarted.ts`; this patch is made against the file as VSCodium leaves it and applies after theirs.

## Dropped: hiding the Terminal tab (an earlier patch, also numbered `0002`)

The first version had a second patch giving the Terminal view in the bottom panel a `when` that went false while Toggle Terminal was hidden, so the tab disappeared. Review of the pinned source (2026-11-02) showed that a view whose `when` is false is inactive, and `ViewsService.openView` returns nothing for an inactive view, so a terminal created in the bottom panel by an extension (`MainThreadTerminalService.$show` to `TerminalGroupService.showPanel`) could no longer be shown. Terminals in the editor area (such as Claude Code's terminal mode) were not affected, but the panel case could not be accepted. The spec's criterion 8 allowed this fallback, so the patch was dropped and the Terminal tab stays. Anyone who wants it gone can hide it from the panel's tab menu. Deleting a file from `ide/patches/` is all it took: the build copies whatever is there.

## Upkeep log

| Upstream version | Patch | Applied cleanly? | What had to change | Time |
|---|---|---|---|---|
| VSCodium 1.143.17232 (Code-OSS 1.143.1) | 0001 (view-menu extension: `menu:` entries) | Forward `git apply --check` on pristine files: yes; type-check: no new errors. Not yet in a full build | Nothing; first version | About 30 minutes |
| VSCodium 1.143.17232 (Code-OSS 1.143.1) | 0002 | Forward `git apply --check` on the file as VSCodium leaves it: yes. Not yet in a full build | Nothing; first version | About 1 hour |
| VSCodium 1.143.17232 (Code-OSS 1.143.1) | 0001 | Yes: applied in four full builds (about 14 minutes each) and by forward `git apply` on pristine files and on the registration file as VSCodium edits it | Nothing from upstream; first version. Found in use and fixed in the patch: a first-launch timing bug, a missing hide pattern (`terminal.integrated.*`), and, from review, repeated groups reordering the menu and an all-conditional menu that stayed absent | Spike about 3 hours including four builds |
