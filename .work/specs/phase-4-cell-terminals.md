# Phase 4, slice 4: Choosing the terminal a cell holds

Status: ready-for-agent (the two **[default]** points approved by the owner, 2026-11-04). Builds on [My layout](phase-4-my-layout.md). Terms follow [GLOSSARY.md](../../GLOSSARY.md).

## Goal

A cell set to Terminal can say which terminal: the shell, a name, the folder it starts in, and a command to run when it opens. Restore Layout opens that terminal in that cell, once.

## What the code established (2026-11-04)

- VS Code's `workbench.action.terminal.newWithProfile { profileName, location: 'editor' }` opens any profile by name, but it sets the folder itself (and asks for one in a multi-root workspace), cannot name the terminal, and returns nothing to send a command to. Not used.
- [shells.ts](../../packages/towelwise/src/shells.ts) already finds this machine's PowerShell, PowerShell 7, Command Prompt, Git Bash and WSL by full path (`detectMachine`, `systemExe`). `vscode.window.createTerminal({ name, shellPath, shellArgs, cwd, location: { viewColumn } })` takes those paths with full control and returns the terminal, so a startup command can be sent to it.
- The saved layout (`towelwise.layout.grid`) is application scope, so a workspace's `.vscode/settings.json` cannot set it. A startup command therefore only ever comes from the person's own Choose Layout page.

## The saved form

A Terminal cell may carry a `terminal` object beside `holds`:

```json
{ "size": 0.5, "holds": "terminal", "terminal": { "shell": "gitbash", "name": "Dev server", "folder": "packages/web", "command": "npm run dev" } }
```

- `shell`: `default` (the person's default profile), `powershell`, `pwsh`, `cmd`, `gitbash` or `wsl`. Absent means `default`.
- `name`, `folder`, `command`: optional text. `folder` is relative to the first workspace folder, or absolute.
- No `terminal` object means today's behaviour, so existing saved layouts keep working unchanged.
- A `terminal` object that does not fit (unknown shell, a field that is not text) makes the whole grid invalid, as an unknown `holds` does today.

## The page

When a cell's choice is Terminal, the cell shows four fields under its dropdown: Shell (Default plus the shells found on this machine), Name, Folder, Startup command. The shell list comes from the extension (the page is told what is available); a saved shell that is not on this machine still shows, marked "not found".

## Restore

- The terminal is opened with `createTerminal` in the target cell: the shell's path and arguments, the folder, and the name. `default` passes no shell path.
- With no folder chosen, or a folder that falls back, the folder is set explicitly to the first workspace folder. Left unset, VS Code would use the last active root of a multi-root workspace, and the startup command could run in a different project (Codex review, 2026-11-04). With no workspace open and no folder chosen, VS Code picks the folder.
- The startup command is sent once, right after the terminal opens, and only when Restore opened it.
- **Already there:** a cell with a name counts as filled when it holds a terminal tab with that name; then nothing opens and nothing runs. **[default]** A cell with no name is named after its shell ("Git Bash"; "Terminal" for Default), so restoring twice never opens a second terminal or reruns a command.
- **Missing pieces:** a shell not found on this machine opens in the default shell, and a folder that does not exist opens in the first workspace folder. Each is reported as a restore problem line, as other placement problems are now.
- **[default]** Administrator shells are not offered: each restore would show the Windows permission prompt.

## Decisions approved

- Terminals first, before file and browser cells. Bottom-panel views (Problems, Output, Debug Console, Ports) stay where they are; they cannot go into cells (owner, 2026-11-04).
- A blank name becomes the shell's name, so restoring twice is safe (owner, 2026-11-04).
- Administrator shells are not offered in cells (owner, 2026-11-04).
- No core patch: terminals open through the extension API, as layout work does under [0005](../../docs/decisions/0005-patch-core-only-when-the-extension-cannot.md).

## Out of scope

Terminal profiles defined in settings or added by other extensions; picking an already open terminal; macOS/Linux shells beyond Default; file and browser cells (a later slice); moving View menu items into the Towelwise menu (later).

## Unresolved questions

- Does an editor-area terminal's tab label stay the `name` passed to `createTerminal`? Codex confirmed it does for Command Prompt in VS Code 1.145.0, and core treats an API-given name as a static title. Git Bash is still to be confirmed in the built app. Acceptance criterion 4 depends on it.

## External prerequisites

- The built-app check needs a full app build (`bash ide/build.sh`), run only when the owner says the machine is free.

## Acceptance criteria

1. Choosing Terminal in a cell shows Shell, Name, Folder and Startup command; saving stores them in the cell's `terminal` object, and an empty field is not stored.
2. A saved layout without `terminal` objects restores exactly as before.
3. Restore opens the chosen shell, named and in the chosen folder, in its cell, and sends the startup command once.
4. Restoring again with that terminal still in its cell opens nothing and runs nothing.
5. A missing shell or folder falls back as described and is reported; the rest of the layout still restores.
6. A malformed `terminal` object makes the grid invalid and is logged, like other malformed grids.

## Verification

Unit tests for parsing the saved form, the page messages, the draft's view and save, and `fillCell` (through the `Editors` seam: opens with the right options, sends the command once, skips a filled cell, falls back and reports). `npm run lint`, `npm run build`, `npm test`. Built-app check (only when the machine is free): Git Bash in a folder with a command, then restore twice.

Test boundaries are the existing ones: `parseSavedGrid`, the `columns` builder functions, `LayoutDraft` and `parseLayoutMessage`, and `applyLayout` through the `Editors` and `MyLayoutHost` seams (gaining `label`, `openTerminal(group, open)` and `planTerminal`). The one new boundary is `cellTerminal.ts` (pure functions, unit-tested).
