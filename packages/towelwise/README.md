# Towelwise

Towelwise helps you focus on the AI coding agents you already use. It only opens panels and changes the window around them; it never drives an agent.

## Commands

| Command | Default key | What it does |
| --- | --- | --- |
| **Towelwise: Jump to Hyperspace** | `Alt+Shift+J` | Hides the parts of the window you choose, leaving your agents in view. Run it again to put your settings back exactly. |
| **Towelwise: Choose Layout** | | Pick the agent panels you want showing. |
| **Towelwise: Restore Layout** | `Alt+Shift+L` | Reopens your chosen panels, in any project. |

New here? Open **Help > Welcome > Get Started with Towelwise**.

## Settings

Search for `towelwise` in Settings.

- `towelwise.hyperspace.*`: what hyperspace hides (activity bar, status bar, menu bar, side bars, bottom panel), and optional full screen. Start from a windowed window if you turn full screen on.
- `towelwise.layout.applyOnStartup`: also apply your layout when a window opens. Off by default.
- `towelwise.layout.commands`: command ids to run after your panels when you restore, for agents that open as an editor tab instead of a side bar. Type the ids yourself; Towelwise cannot see which tabs are open, so a command that opens a new tab each time can duplicate one.

## Things to know

- **Output > Towelwise** is a quiet log of every command Restore Layout ran, skipped or failed. Check it when a restore does not do what you expect.
- Hyperspace changes your real user settings and restores them exactly. While it is on, those settings may also sync to your other devices if Settings Sync is on.
- Panels that hyperspace closes stay closed when you restore. The editor area is never hidden.

Licensed under Apache 2.0.
