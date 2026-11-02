# Core patches

Towelwise AI changes Code-OSS through its built-in extension first, and patches core only where the extension cannot reach ([decision 0005](../../docs/decisions/0005-patch-core-only-when-the-extension-cannot.md)). `ide/build.sh` copies every `*.patch` here into the VSCodium checkout's `patches/user/`, which VSCodium applies after its own patches. Patches are plain `git apply` diffs against the pinned upstream source.

Each patch has a note below: why it exists, what it touches, and how it fared at each upstream update (the upkeep record 0005 asks for).

## 0001 menu hook (`0001-towelwise-menu-hook.patch`)

**Why.** The owner wants to hide built-in features (the integrated terminal, Tasks, later Debug, Testing and Notebooks) and have a Towelwise menu of its own, without a new patch for each change. Spec: [menu-hook.md](../../.work/specs/menu-hook.md).

**What it does.** Two settings that the built-in extension ships are the whole interface: `towelwise.menus.hidden` (command ids or `prefix.*` patterns to hide) and `towelwise.menus.towelwise` (the entries of a new Towelwise menu). A hidden command is not offered in menus, the Command Palette or default shortcuts, but still runs when called by other code.

**What it touches (6 files, one hunk or new file each).**

- new `platform/commands/common/hiddenCommands.ts`: the shared list, its matcher, and a startup default equal to the setting's default so nothing flashes before the setting is read.
- `platform/actions/common/actions.ts`: `MenuRegistry.getMenuItems` returns its result without hidden commands, after the implicit Command Palette items are added, and drops hidden alternate actions; menus rebuild when the list changes.
- `platform/keybinding/common/keybindingsRegistry.ts`: default shortcuts of hidden commands are left out (removal rules and user shortcuts are untouched).
- `workbench/services/keybinding/browser/keybindingService.ts`: rebuilds the resolver when the list changes.
- new `workbench/contrib/towelwise/browser/towelwise.contribution.ts`: reads both settings, applies the list, builds the Towelwise menu (entries keep array order; groups separate sections), sets the context key `towelwise.terminalTabHidden`.
- `workbench/workbench.common.main.ts`: one import, added at the end of the imports, away from the block VSCodium edits.

**Known limits.** Editor actions that the Command Palette reads straight from the active editor are not covered. Typing `term ` in quick open still opens the terminal picker. The built-in JavaScript Debug extension adds its own terminal command.

## 0002 hide the Terminal tab (`0002-towelwise-hide-terminal-tab.patch`)

**Why.** With the integrated terminal's entry points hidden, its tab in the bottom panel should go too. Kept as a separate patch so it can be dropped alone if hiding the view stops terminals from being shown (the spec's criterion 8).

**What it touches (1 file, 2 hunks).** `workbench/contrib/terminal/browser/terminal.contribution.ts`: the Terminal view gets `when: !towelwise.terminalTabHidden`, a context key that 0001 sets while `workbench.action.terminal.toggleTerminal` is on the hidden list.

**Risk.** A view whose `when` is false is inactive, and showing an inactive view returns nothing, so a terminal created in the panel may not be shown. Terminals in the editor area are expected to be unaffected. To be checked in the built app (panel terminal created and shown by an extension; editor terminal).

## Upkeep log

| Upstream version | Patch | Applied cleanly? | What had to change | Time |
|---|---|---|---|---|
| VSCodium 1.143.17232 (Code-OSS 1.143.1) | 0001, 0002 | Yes, forward `git apply` on pristine files and on the registration file as VSCodium edits it | Nothing; first version | Not yet built into an app |
