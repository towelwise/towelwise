# View menu: slim it, and send layout and look to the Towelwise menu

Status: ready-for-agent (scope agreed with the owner, 2026-11-02). One naming default below is proposed, not approved.

## Goal

The second use of the menu hook from [menu-hook.md](menu-hook.md): trim the View menu so a newcomer sees a short list, and leave how the window looks and is laid out to the Towelwise menu (Choose Layout, Restore Layout, Edit Hyperspace Layout), which already sits beside View. Roadmap slice: the strip-down section of [ROADMAP.md](../../ROADMAP.md), after the terminal and Tasks. Windows first.

The View menu in build `1.143.17357` has these entries, read from a fresh profile: Command Palette, Open View, Appearance (submenu), Editor Layout (submenu), Explorer, Search, Source Control, Run, Extensions, Browser, Problems, Output, Debug Console, Word Wrap. The Terminal and Tasks entries are already gone.

## Acceptance criteria

1. **Appearance and Editor Layout leave the View menu.** With the default list, View no longer shows either submenu. Their commands keep their shortcuts and their Command Palette entries: `Ctrl+B` (toggle side bar), F11 (full screen), zoom in and out, and the split-editor commands still work, and typing "Toggle Full Screen" or "Split Editor Right" in the palette still finds them. Only the two menu entries are hidden.
2. **Run and Debug Console leave the View menu.** They are hidden by command id (`workbench.view.debug` and `workbench.debug.action.toggleRepl`), the same way as the terminal and Tasks, so their shortcuts and palette entries go too. The Run icon in the activity bar is a view container, not a command, and is not changed by this slice.
3. **The remaining entries stay:** Command Palette, Open View, Explorer, Search, Source Control, Extensions, Browser, Problems, Output and Word Wrap. On a fresh profile with no editor open, View lists exactly these, in the order VS Code gives them, with no separator left dangling at the top or bottom of a group.
4. **A submenu can be hidden by the same setting.** `towelwise.menus.hidden` accepts a second kind of entry, naming a menu by its id, that removes the submenu item that opens it from every menu without touching the commands inside. Removing the entry from the setting brings the submenu back, live or after a window reload (as the first hook did).
5. **Nothing else moves.** Other menus, the Towelwise menu, the title-bar layout control, the gear and account menus, the right-click menus and every keyboard shortcut outside the hide list are unchanged. Hyperspace, the picker, Choose Layout and Restore Layout behave as before.
6. **A small patch with a note.** The change to the core patch stays small (a few lines in the menu registry's filter, plus the new default entries in the setting), its size is recorded, and the note and upkeep log in [ide/patches/README.md](../../ide/patches/README.md) are updated.
7. Root `npm run lint`, `npm run build`, `npm test` and `npm run package` exit 0.

## Approved decisions (owner, 2026-11-02)

- Hide Appearance and Editor Layout from View; their shortcuts and palette commands keep working.
- The existing Towelwise menu is the pointer to layout and look: no new line in View, no second configurable menu.
- Hide Run and Debug Console now (Debug is already decided as hidden); keep Browser and Word Wrap.
- Extension first, one configurable hook, hide before delete ([0005](../../docs/decisions/0005-patch-core-only-when-the-extension-cannot.md)); the hide list lives in a shipped, editable setting.
- Keep Source Control and MCP (roadmap decisions).

## Implementer defaults (proposed, for the owner to veto)

- **Name of the new kind of entry:** `menu:<MenuId>`, for example `menu:MenubarAppearanceMenu` and `menu:MenubarLayoutMenu` (the ids as the pinned source defines them in `platform/actions/common/actions.ts`). It is exact-match only, with no `*`. The existing rule for command ids is unchanged.
- **How it works:** in the same filter that removes hidden commands from `MenuRegistry.getMenuItems`, a submenu item whose `submenu.id` is on the list is removed too. Because the item is removed and not the commands, shortcuts and palette entries are untouched.
- **Default list:** the current seven entries plus `menu:MenubarAppearanceMenu`, `menu:MenubarLayoutMenu`, `workbench.view.debug` and `workbench.debug.action.toggleRepl`.

## Verification

- **Automated (the extension's tests, the same seam as before):**
  - The manifest's default for `towelwise.menus.hidden` contains the four new entries, and the setting's schema accepts the `menu:<MenuId>` form and still rejects anything that is neither an exact id, a prefix ending in a single `*`, nor a `menu:` id.
  - The existing test that every pattern is an exact id or a trailing-`*` prefix is extended for the new form, with a failing case first (a `menu:` entry that contains a `*`).
- **Patch checks (not unit-testable, as agreed for the first hook):** a type-check of the VS Code tree with zero errors in our files; `git apply --check` forward on pristine copies of the touched files reproducing ours.
- **Build and package:** the four root commands, then one full build.
- **On a fresh profile over the debugging port (no reload):** open View and read its entries (criterion 3); confirm the Appearance and Editor Layout submenus are absent; confirm `Ctrl+B` toggles the side bar and the palette still finds "Toggle Full Screen"; then set the hide list without the two `menu:` entries and confirm both submenus come back, in the same window.
- **Manual (the owner):** look at View, press F11 and `Ctrl+B`, and use the Towelwise menu for layout.

## Out of scope

The rest of the Debug, Testing and Notebooks hiding (their activity-bar icons, side views and palette commands); the Chat and Agents entry and where agents open; Windows Terminal as an entry or host; the pass over the built-in extensions; a new Towelwise settings page; hiding Browser; other menus (File, Edit, Selection, Go, Help).

## Unresolved / external prerequisites

- Whether hiding the Appearance submenu from View also removes it somewhere the owner still wants it (for example a title-bar or gear menu that reuses the same submenu id). The patch note should record what was found in the pinned source; the fresh-profile check covers View only.
- The upkeep cost of carrying the patch across a real upstream update is still unmeasured (Phase 3 criterion 7 waits on a VSCodium 1.144 release).
