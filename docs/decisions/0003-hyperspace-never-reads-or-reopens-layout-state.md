# Hyperspace never reads or reopens layout state

VS Code gives extensions no way to read whether a side bar or the bottom panel is open, or whether the window is full screen (see microsoft/vscode#283331 for area visibility). It offers only close commands and blind toggles. So hyperspace restores settings exactly but not layout:

- Areas hyperspace closes stay closed on restore. Close commands do nothing on an area that is already closed, so a jump never opens anything.
- The editor area is always kept, because its only command is a toggle that could open it.
- True full screen is an opt-in setting that assumes the window starts windowed. The saved state records, after the toggle succeeds, that the jump entered full screen and in which window; only that window toggles it back. A restore from another window, or after a reload, leaves full screen alone and says to press F11.

**Ruled out:** reopening every area on restore (it would open ones that were closed), toggling the editor area, and guessing full-screen state.

**Revisit** if VS Code adds an API to read area visibility or window state.
