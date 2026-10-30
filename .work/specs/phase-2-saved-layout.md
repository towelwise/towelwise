# Phase 2 slice 2: Saved layout

Status: ready-for-agent

## Goal

Second slice of ROADMAP.md Phase 2. Agent side bars often come back closed, or showing another view, after a reload, an update or opening another project. A person chooses once which agent panels they want showing; one command brings them back, in any project. Terms follow [GLOSSARY.md](../../GLOSSARY.md) (**Layout**, **Agent panel**, **Area**, **Hyperspace**).

VS Code gives extensions no way to read or move the layout ([decision 0003](../../docs/decisions/0003-hyperspace-never-reads-or-reopens-layout-state.md)). It does give every view container a "show" command that opens it where it already lives. So a layout is declared by the person, not captured, and applying it means showing each chosen container.

Example (the user's own setup): Antigravity's container in the primary side bar and Codex's in the secondary side bar. Applying the layout brings both side bars back showing those agents.

## Acceptance criteria

1. **Towelwise: Choose Layout** shows a multi-select list of side-bar containers that installed extensions add, plus VS Code's built-in Chat. The current layout is pre-selected. Confirming saves the chosen containers, in order, to one user setting, so the layout is the same in every project. Cancelling changes nothing.
2. **Towelwise: Restore Layout** exists in the Command Palette with a default keybinding. It shows each container in the layout, in saved order, where that container already lives. It never moves a container between areas and never closes anything. When two chosen containers share an area, the one shown last is the one visible.
3. If a container in the layout is not available (its extension is not installed or not enabled), the others are still shown and one quiet message names what was skipped. The saved layout is left unchanged.
4. With an empty layout, Restore Layout does nothing except a quiet message pointing to Choose Layout.
5. An opt-in setting, off by default, also applies the layout when a window opens. It is skipped while hyperspace is on, so it never reopens what hyperspace hid. Running Restore Layout by hand still applies it during hyperspace.
6. An application-scoped setting, `towelwise.layout.commands`, lists command ids (for example an agent's own "open chat") that Restore Layout runs after the containers, in order. A listed command that does not exist is skipped and named in the same quiet message, and the setting is unchanged. Apply on startup does not run them. There is no picker for them; the person types the ids.
7. Restore Layout and apply-on-startup write a line to a "Towelwise" output channel for every command they run (`ran`), skip because it does not exist (`skipped`), or that fails (`FAILED`, with the error, before the error is reported). The channel never opens or pops up by itself.
8. Root `npm run lint`, `npm run build`, `npm test` and `npm run package` exit 0, and CI passes on the PR.

## Approved decisions (user, 2026-10-30, grilling session)

- The problem to solve is side bars coming back closed or showing another view. The Claude Code editor tab is not a problem today and is out of scope.
- A layout is declared through a picker (Choose Layout), not edited by hand and not captured.
- One layout per person, stored as a user setting. Named layouts are a later roadmap slice.
- Apply: a command with a default keybinding, plus an opt-in, off-by-default apply when a window opens.
- A missing container is skipped and named; the layout is not changed.
- Hyperspace wins on startup: automatic apply is skipped while hyperspace is on.
- Layout commands (user, 2026-10-30, after Claude Code opened as an editor tab, `claudeCode.preferredLocation: "panel"`, and Restore did not bring a closed chat back): a vendor-neutral list of command ids that Restore runs after the containers, chosen over Claude-specific support (decision 0001) and over doing nothing. Implementer choices, approved by the user on 2026-10-30 after Codex's review: the setting name `towelwise.layout.commands`, no picker, and not running them on startup apply (VS Code usually restores open tabs itself, so a new-tab command could duplicate them).
- Output log (user, 2026-10-30, after Restore with `claude-vscode.editor.openLast` showed no chat and nothing could say why): a quiet "Towelwise" output channel. Finding from reading Claude Code's own code the same day: `openLast` just runs `claude-vscode.editor.open` (a NEW chat) when the preferred location is not the side bar. For "reopen the chat I just closed by accident" the right command is `claude-vscode.reopenClosedSession`, which reopens the most recently closed chat (same conversation, same column), skips ones already open, and falls back to VS Code's "Reopen Closed Editor" (any editor type) when nothing is remembered; its memory is in-session only, so it is lost on a window reload. Towelwise stays vendor-neutral: this is only a suggestion for the person's `towelwise.layout.commands`.
- Review of `9f19831` (user, 2026-10-30): a container is shown through its first view's own focus command (it never toggles, so Restore cannot close an agent moved to the bottom panel), with the container command only as a fallback. VS Code cannot say which of an extension's containers is enabled, so the picker lists all of them with area and id, and restore reports which show commands ran, not what became visible. Both layout settings are application-scoped, so a project cannot override them. The first view used for a container is the one from the extension that declares it; another extension's view is only a fallback when the owner contributes none.
- Test seam: applying a layout, observed through the same stand-in command runner hyperspace tests use. The picker UI and real side bars are checked by hand.

No new decision record: a declared layout follows directly from [0003](../../docs/decisions/0003-hyperspace-never-reads-or-reopens-layout-state.md).

## Verification

- **Automated (approved seam):** extension tests with a stand-in command runner. Cases: (a) a saved layout of two containers runs their show commands in saved order; (b) a container that is not available is skipped, the others still run, the skipped one is reported, and the setting is unchanged; (c) an empty layout runs nothing; (d) startup apply runs only when its setting is on and hyperspace is off. Use `tdd`.
- **Smoke checks:** lint, build and package exit 0 locally and in CI on the PR.
- **Manual:** after installing the VSIX and reloading, choose Antigravity and Codex in Choose Layout; close both side bars and run Restore Layout; open another project and run it there; turn on startup apply and reload; jump to hyperspace with a side bar set to hide, reload, and confirm startup apply did not reopen it.

## Implementer defaults (approved by the user, 2026-10-30, after trying the installed build)

- The default key: `Ctrl+Alt+L` when built, changed on 2026-10-30 to the chord `Ctrl+K L`, then the same day to `Alt+Shift+L`, for the same AltGr reason as hyperspace. Checked against VS Code's default shortcuts and the installed extensions.
- Setting names: `towelwise.layout.containers` (an ordered list of container ids) and `towelwise.layout.applyOnStartup`, both application-scoped.
- The picker lists the side-bar and secondary-side-bar containers that installed extensions contribute, plus built-in Chat, each labelled with its title, area and id. It does not list bottom-panel containers.
- "Not available" means no show command exists for the container in VS Code.

## Manual verification so far (user, 2026-10-30)

Confirmed on the user's machine with Antigravity, Claude Code, Codex and Chat: Choose Layout saved a selection and Restore Layout reopened the closed side bars as chosen; hyperspace with one agent open jumped and restored correctly; `Ctrl+Alt+L` after that brought back the three-column layout. Still unchecked: restore in another project, startup apply, and startup apply while hyperspace hides a side bar.

## Out of scope

- Named layouts (roadmap slice 4).
- Detecting, listing or picking agent editor tabs. They are reopened only by commands the person lists in `towelwise.layout.commands`, and a command that opens a new tab each time can duplicate an open one (Towelwise cannot see open tabs).
- Moving containers between areas, or closing anything.
- Capturing the current layout automatically.
- A guided first-run setup (beginner-profile slice).

## Unresolved / external prerequisites

- Whether a container's show command reliably opens a closed side bar for every agent (verified only on Windows with the user's three agents, by hand).
- Behaviour on macOS and at the VS Code 1.90 floor is unchecked.
