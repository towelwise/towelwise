# Towelwise

A VS Code extension that arranges the workspace around the AI coding agents a person already uses, without ever driving them.

## Language

**Agent**:
A third-party AI coding extension that Towelwise recognises, such as Claude Code, Codex or Copilot.
_Avoid_: Assistant, bot, plugin

**Agent panel**:
The vendor's own view where a person works with an agent.
_Avoid_: Agent window, chat

**Area**:
One of the places an agent panel can sit: the primary side bar, the editor area, the secondary side bar or the bottom panel.
_Avoid_: Column, part, region

**Chrome**:
The parts of VS Code that frame the areas without holding agent panels, such as the activity bar, status bar and menu bar.
_Avoid_: UI, decorations

**Hyperspace**:
A temporary state in which Towelwise hides the chrome and areas a person chose, leaving only their chosen areas visible until they restore.
_Avoid_: Focus mode, zen mode

**Restore**:
Leaving hyperspace by putting every setting Towelwise changed back exactly as it was before the jump.
_Avoid_: Undo, reset
