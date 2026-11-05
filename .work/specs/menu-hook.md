# Menu hook: hide built-in entries from a list, and our own Towelwise menu

Status: ready-for-agent (defaults and entries contract approved by the owner, 2026-11-02)

> **Revised 2026-11-03:** the owner withdrew hiding by default. `towelwise.menus.hidden` now ships empty and the patch's startup default is empty, so every built-in menu shows. The hook and the `menu:` form are unchanged and a person can still list entries to hide. The default lists and the "hidden by default" criteria below describe the earlier plan and no longer hold.

## Goal

The first committed core patch, as planned in [decision 0005](../../docs/decisions/0005-patch-core-only-when-the-extension-cannot.md): one small configurable hook, so hiding built-in features and adding Towelwise's own menu are data in a setting, not a new patch each time. It delivers the terminal decision in the strip-down section of [ROADMAP.md](../../ROADMAP.md): keep the integrated terminal, hide its user entry points, and open shells outside the IDE from [the external shells](external-shells.md). It also hides Tasks, which shares the Terminal menu and was decided hidden. Hiding Debug, Testing and Notebooks reuses the same hook in a later slice. Windows first.

## Acceptance criteria

1. **The build carries the patch.** `ide/build.sh` copies `ide/patches/*.patch` into the VSCodium checkout's `patches/user/` after its reset and clean steps and before VSCodium prepares the source. The patch applies cleanly to the pinned release, the app builds and launches, and the built workbench contains the hook. (The same hook that the dropped layout-mode spike proved; the build step was never committed.)
2. **A hide list in a setting.** The built-in extension contributes `towelwise.menus.hidden`, a list of command ids at application scope, with a default that covers the integrated terminal and Tasks. An entry is an exact command id, or a prefix ending in `*` (for example `workbench.action.terminal.*`). The default must include the three editor-terminal commands that sit outside that prefix: `workbench.action.createTerminalEditor`, `workbench.action.createTerminalEditorSide` and `workbench.action.createTerminalEditorSameGroup` (found in review: the first two are in the Command Palette, the third is an editor-title action). It must also include `workbench.action.quickOpenTerm` ("Switch Active Terminal"): its picker always offers "Create New Terminal" and "Create New Terminal With Profile", so leaving it visible would keep a Command Palette route to a new integrated terminal even though the New command is hidden. A scan of every terminal command id outside the prefix found no other creation route among workbench commands; the two picker-navigation ids (`workbench.action.quickOpenNavigateNextInTerminalPicker` and `...Previous...`) only move within that picker and are left alone. A first check in the built app found one more: the built-in terminal-suggest extension adds a palette command ("Terminal: Clear Suggest Cached Globals", `terminal.integrated.suggest.clearCachedGlobals`) outside both prefixes, so the default also includes `terminal.integrated.*`.
3. **Hidden everywhere the person can reach it, for workbench commands.** A workbench command on the list no longer appears in the top menus, the Command Palette or the right-click menus, including as an alternate (`alt`) menu action, and its default keyboard shortcuts no longer fire. In the default setup this includes the terminal's New Terminal, the three editor-terminal commands, Toggle Terminal and the Ctrl+Backquote shortcuts, and the Tasks entries. **The promise is deliberately narrower for editor actions** (owner, 2026-11-02): the Command Palette also lists actions read straight from the active editor (for example `editor.action.commentLine`), by a path that does not go through the menu registry. Listing such an id hides its menu items and shortcuts but not its palette entry. Nothing in this slice needs them hidden; a later slice (Debug has some editor actions) can add that path when it is needed.
4. **Hiding is not disabling.** Hidden commands still run when other code calls them. Claude Code's optional terminal mode ("Claude Code: Open in Terminal") and any extension that calls the terminal API keep working.
5. **The list takes effect without a rebuild.** Editing the setting changes what is hidden, live, or at worst after a window reload (the spike records which, because live needs the menus and the keybinding resolver to be told to rebuild); the person can empty the list to bring everything back. At startup, filtering applies before any menu or keybinding result is cached from the unfiltered state.
6. **A Towelwise menu.** A new top-level **Towelwise** menu appears in the menu bar, between existing menus and not replacing any. It holds Jump to Hyperspace, Edit Hyperspace Layout, Choose Layout, Restore Layout, then a separator, then the external shell entries that are installed (PowerShell, PowerShell (Admin), Command Prompt, Command Prompt (Admin), Git Bash, and PowerShell 7 and WSL only when installed). Each entry runs its command. The menu is present whenever at least one entry is visible, including when every entry started out hidden by its condition and one becomes visible after startup (found in review: the menu bar drops a menu with nothing to show and does not watch the conditions inside it, so the hook registers the top-level item again when a condition an entry reads changes). The menu's contents come from a second setting contributed by the built-in extension, not from the patch, in the shape given under "The menu-entries contract" below. The menu's title uses the workbench's structured title form (with a mnemonic), because the custom menu bar ignores a plain string.
7. **The Terminal menu goes.** With the default list, the top-level Terminal menu no longer shows. If the menu bar leaves an empty one visible, the spike records it and hides it with the same hook.
8. **The Terminal panel tab stays (the fallback, decided after review, 2026-11-02).** Hiding the tab was tried as a separate patch and dropped: a view whose `when` is false is inactive, and showing an inactive view returns nothing, so a terminal created in the bottom panel by an extension could no longer be shown (`MainThreadTerminalService.$show` to `TerminalGroupService.showPanel` to `ViewsService.openView`, read from the pinned source by Codex). Terminals in the editor area, such as Claude Code's terminal mode, were not affected, but the panel case could not be accepted. The tab is left as it is, and a person can hide it from the panel's tab menu. The integrated terminal itself is untouched, and its menu items, palette commands and shortcuts stay hidden by the list.
9. **A small patch with a note.** The patch is new files plus the smallest edits to the shared menu registry and keybinding path (filtering the final result after implicit items are added), with its size recorded and a note kept with it (why it exists, what it touches, how it re-applied on each upstream update, with the time taken), as 0005 requires.
10. Hyperspace, the picker, Choose Layout, Restore Layout and the shell commands behave as before. Root `npm run lint`, `npm run build`, `npm test` and `npm run package` exit 0, and CI passes on the PR.

## Approved decisions (owner, 2026-11-02)

- Extension first; patch only what the extension cannot do; prefer one configurable hook ([0005](../../docs/decisions/0005-patch-core-only-when-the-extension-cannot.md)).
- Keep the integrated terminal, hide its entry points, open shells externally (the list and the Admin entries are in [external-shells.md](external-shells.md) and the roadmap).
- Hide Tasks, Debug, Testing and Notebooks; keep MCP and Source Control. This slice does the terminal and Tasks.
- The hide list lives in a setting we ship, visible and editable.
- The spike covers everything: menus, palette, shortcuts and the panel tab, plus adding our own entries.
- A separate top-level Towelwise menu, not a renamed Terminal menu.
- Test boundary (owner, 2026-11-02): automated tests on the extension side; the patch checked by a type-check, a forward `git apply` on a clean file, the build, and the owner's look at the built app.
- The hide list's promise covers workbench commands in menus, the palette and shortcuts; editor actions read from the active editor are out of this slice (owner, 2026-11-02, after Codex's review).

## The menu-entries contract (approved by the owner, 2026-11-02)

`towelwise.menus.towelwise` is an array of objects, in display order, so the extension that writes it and the patch that reads it agree on one shape:

| Field | Type | Meaning |
|---|---|---|
| `command` | string, required | A command id. Runs when the entry is chosen. |
| `title` | string, required | The text shown, with an optional `&` before the letter to use as the mnemonic. |
| `group` | string, optional | A change of group draws a separator, so entries are shown in array order with a separator wherever the group changes. A group name that comes back after another group is a new section, not a return to the first one, so the array order is never rearranged. Default: the previous entry's group. |
| `when` | string, optional | A context-key expression, such as `towelwise.shell.available.gitbash`. The entry shows only while it is true. Default: always. |

Malformed entries (not an object, no `command` or `title`, a non-string field, an expression that does not parse) are skipped, and one warning is logged naming the position; the rest still show. Unknown fields are ignored. The manifest contributes a JSON schema for this setting, so the settings editor also checks what the person types. Order is the array order, and the patch must keep it: it gives each entry an explicit order and must not let the menu's own group sorting reorder them. The menu's position in the menu bar and its title are fixed by the patch.

## Verification

- **Automated (the extension's tests, same seam as the others):**
  - The manifest contributes `towelwise.menus.hidden` with scope `application`, a list type, and a default that contains the terminal pattern, the three editor-terminal ids, `workbench.action.quickOpenTerm`, `terminal.integrated.*`, and the Tasks pattern; and the menu-entries setting with the entries in criterion 6.
  - The menu-entries default validates against the contract above (every entry has a string `command` and `title`, and any `group` and `when` are strings), and the manifest's schema for the setting matches the contract; a validator for the contract lives in the extension and is tested with good entries and with each kind of malformed entry. The condition check ignores brackets and operators inside quoted text and regular expressions (found in review: `resourceFilename == 'a(b'` and `resourceFilename =~ /\(/` are valid and must not be reported as skipped), and a pure function places entries by runs of equal groups, with tests for a group that comes back, so extension and IDE share one stated rule.
  - Every command id in the menu-entries default is a command the extension registers or contributes, so the menu cannot point at nothing.
  - The shell entries in the menu-entries default carry the same availability gating (`when`) as their palette entries, and each `when` names a context key the extension sets.
  - No default keybinding for a Towelwise menu command is added.
- **Patch checks (not unit-testable):** a type-check of the VS Code tree with zero errors in our files; `git apply --check` forward on a clean copy of each touched file, reproducing our files; the full build exits 0 and the built bundle contains the hook.
- **Build and package:** the four root commands.
- **Manual (the owner, built app):**
  - The menu bar shows Towelwise and no Terminal menu; every Towelwise entry runs; the shell entries appear only for installed shells.
  - Search the Command Palette for "Terminal:" and "Tasks:": the hidden ones are gone, including "Create New Terminal in Editor Area", "...to the Side" and "Switch Active Terminal". Press Ctrl+Backquote: nothing happens.
  - Look at the bottom panel's tabs: Terminal is still there (criterion 8, the fallback).
  - Run "Claude Code: Open in Terminal": it still opens its terminal and runs. If the tab was hidden, also check a terminal in the bottom panel can be created and shown by an extension, as well as one in the editor area.
  - Empty `towelwise.menus.hidden` and confirm everything returns; put a pattern back and confirm it is hidden again. Record whether this takes effect live or after a reload.
  - Edit `towelwise.menus.towelwise` (change a title, move an entry to another group, delete one, add one with a mistake in it): the Towelwise menu follows, the bad entry is skipped, and a warning appears in the log. Record whether this takes effect live or after a reload.

## Implementer defaults (approved by the owner, 2026-11-02)

- Setting names `towelwise.menus.hidden` and `towelwise.menus.towelwise`, and the default hide list: `workbench.action.terminal.*`, `workbench.action.createTerminalEditor`, `workbench.action.createTerminalEditorSide`, `workbench.action.createTerminalEditorSameGroup`, `workbench.action.quickOpenTerm`, `terminal.integrated.*`, `workbench.action.tasks.*`, plus the Tasks entries in the Terminal menu by their command ids.
- Pattern syntax: exact id, or a trailing `*` for a prefix; nothing more.
- The menu-entries contract above, including skipping malformed entries with a logged warning.
- The Towelwise menu's contents and order (Hyperspace group, Layout group, then Shells), and its position in the menu bar.
- The patch is a new workbench contribution file, edits to the menu registry (filter the final result of `getMenuItems`, after implicit items are added) and to the keybinding default list, and one registration line, as in the layout-mode spike. The first version also hid the Terminal tab with a second patch, which was dropped (criterion 8). The built patch is six files (two new, four edited, one of them the registration import) and +240/-2 lines; its upkeep is recorded in `ide/patches/README.md`.
- Entries run existing command ids; no new commands are added by the patch.
- macOS native menus are not handled (Windows first).

## Out of scope

- Hiding Debug, Testing and Notebooks (the same hook, a later slice), and any removal of code.
- The Chat view and the Agents entry; Windows Terminal as an entry; a pass over the built-in extensions.
- Native macOS and Linux menus; keyboard shortcut editing beyond removing defaults for hidden commands.
- Hiding editor actions from the Command Palette (the palette reads them from the active editor, not the menu registry); needed later for Debug.
- Two routes a hide list cannot close, recorded so they are not found by surprise: typing `term ` in the quick-open box opens the same terminal picker (a quick-access prefix, not a command), and the built-in JavaScript Debug extension adds its own "Create JavaScript Debug Terminal" command (a Debug-slice item). Neither is needed for this slice's promise; the spike notes whether either matters in practice.
- Changing the integrated terminal itself.

## Unresolved / external prerequisites

- Whether the Terminal panel tab can be hidden without breaking code that asks for a terminal (criterion 8): answered by review and the pinned source: not safely. The tab stays and the patch was dropped.
- Whether a new top-level menu renders correctly in the custom title bar's menu bar, and whether the empty Terminal menu disappears by itself (criteria 6 and 7): found by the spike.
- Whether the hook can read the setting early enough that no hidden entry flashes at startup. Found in the built app (2026-11-02): on a first launch the contribution runs before the built-in extension has registered its settings, so the Towelwise menu did not appear until a window reload. Two causes, the second found only after the first fix did not help: the settings were read too early, and the menu bar redraws only when its main menu changes, not when a submenu gains entries, so a top-level item registered first and filled later never showed. The hook now keeps a compiled-in startup default for the hide list (so nothing flashes), reads both settings again once extensions have registered, and adds the top-level item last on every rebuild. Confirmed by asking a fresh instance for its menu bar before and after a reload; the second fix is checked in the next build.
- The upkeep cost of carrying this patch across a real upstream update (Phase 3 criterion 7 still waits on a VSCodium 1.144 release).
