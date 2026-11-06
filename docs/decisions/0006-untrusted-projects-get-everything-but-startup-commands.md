# In an untrusted project, Towelwise AI works but runs no startup commands

Status: approved by the owner (2026-11-05). Answers finding 7 of the Phase 4 release audit.

Restricted Mode (a project the person has not trusted) disables any extension that does not declare support for it, and the built-in extension declared nothing. So in an untrusted project the whole product was missing: no layout, no hyperspace, no restore, and no recovery of settings that hyperspace changed. The layout itself lives in user settings, so a project cannot plant one. The real risk is a startup command such as `npm run dev`, which runs the untrusted project's own scripts.

**Decision.** The extension declares limited support. In an untrusted project everything works, except that terminals the layout opens get no startup command. If the person trusts the project during the session, Towelwise tells them that the startup commands will run once they reload the window. Nothing starts on its own when trust is granted.

**Clarified 2026-11-05 (built-app check, no change in policy).** Towelwise omits startup commands in untrusted projects; by default, Code-OSS also asks for trust before starting the shell, and cancelling can close the terminal and its empty column. The owner accepts this core behavior.

**Ruled out**

- **Full support.** Opening an untrusted repo would run its scripts without the person ever choosing to.
- **Staying disabled.** The product's main features, and recovery of the person's own settings, would vanish in every untrusted project.
- **Running withheld commands the moment trust is granted.** Processes would start while the person is doing something else.

**Revisit** if another feature starts running project code (tasks, agents' own commands on the person's behalf), since each such feature has to be withheld the same way.
