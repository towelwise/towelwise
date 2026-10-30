# Hyperspace writes user settings and restores them exactly

Hiding the activity bar, status bar and menu bar means changing VS Code settings. Hyperspace writes them to the user (global) settings. The first jump saves the previous value of each setting, including "not set", once, in a file in extension storage shared by all windows. Restore puts each value back exactly, so an unset setting becomes unset again. Hyperspace is one state shared across windows.

**Ruled out:** writing workspace settings. That creates or edits `.vscode/settings.json` inside the project, which can end up committed, and the menu bar setting cannot be set per workspace.

**Consequences:** other open windows also lose the hidden bars while hyperspace is on. A workspace setting that forces a bar visible beats the user setting; hyperspace hides everything else, names the blocking setting, and never writes workspace settings. Jumps and restores are serialized across windows with per-window lock files, because overlapping transitions could lose the saved values.
