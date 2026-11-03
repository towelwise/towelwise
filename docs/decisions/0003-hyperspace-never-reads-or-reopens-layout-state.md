# Hyperspace never reads or reopens layout state

VS Code gives extensions no way to read whether a side bar or the bottom panel is open, or whether the window is full screen (see microsoft/vscode#283331 for area visibility). It offers only close commands and blind toggles. So hyperspace restores settings exactly but not layout:

- Areas hyperspace closes stay closed on restore. Close commands do nothing on an area that is already closed, so a jump never opens anything.
- The editor area is always kept, because its only command is a toggle that could open it.
- True full screen is an opt-in setting that assumes the window starts windowed. The saved state records, after the toggle succeeds, that the jump entered full screen and in which window; only that window toggles it back. A restore from another window, or after a reload, leaves full screen alone and says to press F11.

**Ruled out:** reopening every area on restore (it would open ones that were closed), toggling the editor area, and guessing full-screen state.

**Revisit** if VS Code adds an API to read area visibility or window state.

## Amendment (owner, 2026-11-03): sizes are read through a core bridge

Towelwise AI now patches core ([0004](0004-towelwise-ai-is-an-ide-built-from-code-oss-patches.md), [0005](0005-patch-core-only-when-the-extension-cannot.md)), so the "never reads" premise no longer holds for sizes. A small bridge patch lets the built-in extension read whether the primary side bar, secondary side bar and panel are visible, their sizes, the panel's position and the window's size, and set those three sizes ([the sizes spec](../../.work/specs/phase-4-sizes.md)). Hyperspace uses it to apply the person's sizes on a jump and to put the previous sizes back on restore, only for parts still visible and only in the window that jumped.

What stays: areas hyperspace closes still stay closed on restore, the editor area is still always kept, and full screen follows the rule above. Reopening areas on restore, now that visibility can be read, would be a new decision, not part of this amendment.
