# Towelwise

The built-in extension of [Towelwise AI](../../README.md). It helps you focus on the AI coding agents you already use. It only opens panels and changes the window around them; it never drives an agent.

This extension is not released on its own. It runs inside Towelwise AI, and also in stock VS Code 1.90 or newer, where anything that needs the IDE's core patches is not available: the Towelwise menu, hidden menu entries, sizes, and moving panels between areas.

## Commands

| Command | Default key | What it does |
| --- | --- | --- |
| **Towelwise: Jump to Hyperspace** | `Alt+Shift+J` | Hides the parts of the window you choose, leaving your agents in view. Run it again to put your settings back exactly. |
| **Towelwise: Edit Hyperspace Layout** | | A clickable mock window where you choose Keep or Hide for each part, and set the sizes hyperspace uses. |
| **Towelwise: Choose Layout** | | A page where you choose your agents, where each lives (a side bar, the bottom panel or an editor column), build the editor columns, add terminals, set sizes, and save. |
| **Towelwise: Restore Layout** | `Alt+Shift+L` | Puts everything back where your saved layout says, in any project. Not while hyperspace is on. |
| **Towelwise: Open PowerShell**, **Command Prompt**, **Git Bash**, and more | | Opens a shell in a normal window outside the IDE, starting in your project folder. The Admin entries show Windows' own permission prompt. PowerShell 7 and WSL show only where installed. Windows only. |

New here? Open **Help > Welcome > Get Started with Towelwise**. In Towelwise AI, the **Towelwise** menu in the menu bar lists these too.

## Settings

Search for `towelwise` in Settings.

- `towelwise.hyperspace.*`: what hyperspace hides (activity bar, status bar, menu bar, command palette box, layout buttons, side bars, bottom panel), optional full screen, and the `sizes` and `editorGrid` it applies. **Edit Hyperspace Layout** sets these for you. Start from a windowed window if you turn full screen on.
- `towelwise.layout.agents`, `towelwise.layout.grid`, `towelwise.layout.sizes`: your layout. Set them with **Towelwise: Choose Layout**. **Restore Layout** moves each agent to its place, builds the editor columns and sets the sizes. It never closes a tab. If an agent is also open as an editor tab, it tells you and offers to close that tab. Once `agents` is set, `towelwise.layout.containers` and `towelwise.layout.commands` are ignored.
- `towelwise.layout.applyOnStartup`: apply your layout when a window opens, once its editors have restored, as Restore Layout does. On by default. It is skipped while hyperspace is on. Without a layout saved with Choose Layout, it applies only the older `containers` list, quietly.
- `towelwise.layout.commands`: command ids to run after your panels when you restore, for agents that open as an editor tab instead of a side bar. Type the ids yourself; Towelwise cannot see which tabs are open, so a command that opens a new tab each time can duplicate one.
- `towelwise.menus.hidden` and `towelwise.menus.towelwise`: hide built-in commands and menus, and shape the Towelwise menu. Towelwise AI only.

## Things to know

- **Output > Towelwise** is a quiet log of every command Restore Layout ran, skipped or failed. Check it when a restore does not do what you expect.
- **Drift.** With a layout saved, Towelwise compares the window with it when the window gains focus and every 30 seconds while focused. If the editor columns' shape or sizes, or a side bar or the panel, differ by more than a few percent, one notification offers **Save this layout** (or **Edit layout…** when the shape changed), **Restore saved layout** or **Not now**. **Not now** keeps it quiet until something changes again, and the saved layout applies at the next window start. It never prompts while hyperspace is on or Choose Layout is open. Moving an agent to the other side bar is not noticed; the next apply puts it back.
- **Terminals in editor columns open fresh.** They are not restored by VS Code on reload; the layout opens them again. A process running in one ends on reload, and its startup command starts it again.
- Hyperspace changes your real user settings and restores them exactly. While it is on, those settings may also sync to your other devices if Settings Sync is on.
- Saving a layout writes three user settings one after another. If a window closes in the middle, the next window to start puts back what was half written.
- Panels that hyperspace closes stay closed when you restore. The editor area is never hidden.

Licensed under Apache 2.0.
