# Towelwise AI — Roadmap

> **YOUR IDE Built for Hyperspace**
> *Don't Panic.*

Towelwise AI is built around three things, and you build all three:

- **Hyperspace:** a focus mode laid out exactly your way.
- **Recall:** a memory of what you approved, contained to the IDE.
- **Learning:** lessons drawn from your own work.

Updated October 31, 2026 · Johnny T

This is the working roadmap: the order things get built, and what "done" means for each step. Dates come after the first prototype, from real hours rather than guesses.

**The pivot (October 31, 2026):** Towelwise began as a VS Code extension. It is now **Towelwise AI**, an IDE built from Code-OSS. See [decision 0004](docs/decisions/0004-towelwise-ai-is-an-ide-built-from-code-oss-patches.md).

---

## The plan at a glance

| Phase | What | Status |
|---|---|---|
| 0 | Claim the names | Done |
| 1 | Set up the workshop | Done |
| 2 | Extension groundwork (hyperspace, layout, walkthrough) | Done; becomes the built-in extension |
| 3 | **First build** of Towelwise AI | Done (2026-11-03); the timed upstream update is standing upkeep |
| 4 | **The layout editor** and locked hyperspace | Next |
| 5 | The memory experiment (Hindsight on Windows) | Can run alongside Phase 4 |
| 6 | **Towelwise Recall**: the mailbox, then the Probability Drive | — |
| 7 | **Towelwise Guide**: fundamentals library first | — |
| 8 | **DOUG**: later, once there's memory worth briefing from; not one of the core three | — |

The guiding rule: **a small, real prototype in weeks, not a finished suite in 2027.**

---

## Phase 0 — Claim the names

- [x] `towelwise` GitHub organization
- [x] `towelwise/.github` org profile README
- [x] `towelwise.github.io` site, live on GitHub Pages
- [x] VS Code Marketplace publisher `towelwise`
- [x] Open VSX namespace `towelwise`: Eclipse account and Publisher Agreement done; namespace verified 2026-10-29 (EclipseFdn/open-vsx.org #14818)
- [x] License: Apache 2.0

**Done when:** every name is held, and the license is picked so the first repo can include it.

---

## Phase 1 — Set up the workshop

- [x] Main code repo (`towelwise/towelwise`), with parts as separate packages
- [x] Apache 2.0 `LICENSE` and `NOTICE`, README, `CONTRIBUTING.md`, code of conduct, issue and PR templates
- [x] Protected `main`: changes only through pull requests, checks must pass
- [x] CI on every pull request: lint, tests, and package a `.vsix` to prove it builds
- [x] `docs/decisions/` for short decision records (one page each: the choice, why, what was ruled out)
- [x] House rules for every agent (`CLAUDE.md` / `AGENTS.md`, now kept locally and not in the repo)

**Done when:** an empty extension builds in CI and installs from the packaged `.vsix`.

---

## Phase 2 — Extension groundwork

Built and tested in real use as a VS Code extension, never released. This code becomes the IDE's built-in extension.

- [x] **Jump to hyperspace.** One key hides the chrome and areas you chose, and the same key puts your settings back.
- [x] **Saved layout.** Choose the agent panels to show and bring them back with one key, or when a window opens.
- [x] **Layout commands and log.** Run commands such as an agent's "reopen closed chat" on restore, with a quiet Output log of what ran.
- [x] **First-run walkthrough.** A short guided start, shown once.

---

## Phase 3 — First build

A real Towelwise AI app for Windows, with no core patches of our own. See [the spec](.work/specs/phase-3-first-build.md).

- [x] Build scripts and patches on upstream Code-OSS, starting from VSCodium's
- [x] Its own name, icon and data, side by side with VS Code
- [x] Open VSX as its store; telemetry off
- [x] Phase 2's code built in
- [x] Claude Code and Codex install, sign in fresh, and work
- [ ] One real upstream update done and timed. Standing upkeep from 2026-11-03: none was available when Phase 3 closed (pinned 1.143.17232 was the newest VSCodium tag), so it is done and logged when VSCodium next releases

**Closed 2026-11-03 (owner):** the owner uses the app daily, and Claude Code and Codex install, sign in and work in it.

**Done when:** you can run the app daily, and an upstream update has been done and measured, so we know whether the upkeep is sustainable.

---

## Phase 4 — The layout editor

The first core patch, kept small and careful. This is the headline feature: your UI, your way.

**Slice order (owner, 2026-11-03):** sizes first ([spec](.work/specs/phase-4-sizes.md)), then editor-grid layouts, then locked hyperspace. The first-run screen needs no patch and can come at any time. Default keys are close to trivial.

1. **The layout editor.** Turn each part of the window on or off, and set its width and height. On or off is done: the Edit Hyperspace Layout picker shows a mock window where you choose Keep or Hide for each part. Boxes drawn over the live window were tried as a spike on 2026-11-02 and dropped, because the picker was clearer and the boxes looked worse. Setting widths and heights is what still needs the first core patch.
2. **Save as your hyperspace layout.** Sizes are proportions at first, so they carry across screens.
3. **Locked hyperspace.** While it's on, the window holds to your layout and no other way. Anything that wants to open shows a notification instead; click it and it opens in a hovering window you can dismiss.
4. **Default keys** for going in and out of hyperspace, with more to come. Today's defaults are `Alt+Shift+J` and `Alt+Shift+L`.
5. **Works for anyone:** agents, plain text editing without AI, folder lists, whatever they choose.
5a. **Editor-grid layouts (owner, 2026-11-03).** Several agents and panels side by side in the editor area, for example three columns: Claude Code, Codex, and a third split into a terminal above the Recall dashboard. The built-in `vscode.setEditorLayout` command sets nested editor groups with proportional sizes, Claude Code opens as an editor tab, terminals can open in the editor area, and hyperspace always keeps the editor area, so no core patch is expected. The slice starts with a short test: whether Codex opens in a chosen group (it declares an editor, `chatgpt.conversationEditor`), and whether both agents' tabs come back after a reload. This overlaps "named layouts" below.
6. **First-run screen.** "Works with Claude Code and Codex", with install buttons that download from Open VSX on your click, a list of more agents (each checked and tried first), and a real "edit without AI" choice. Agents are never bundled, and sign-in stays in the agent's own panel.

Later: pixel-exact or per-monitor layouts, and named layouts ("three agents", "just Claude"), which wait until daily use shows a need. If built, switching closes the side areas first, then opens the layout's panels.

**Done when:** you set your own widths once, jump, and the window is exactly that every time, through reloads and updates.

---

## Phase 5 — The memory experiment

A spike that answers whether Recall's memory works the way the vision says, before building any UI for it.

- [ ] Hindsight running on Windows as a small local service
- [ ] Storing approved text as-is, with no AI model (chunks mode); observations off
- [ ] Background codebase survey and auto-injection turned off, so no hidden AI runs
- [ ] A quarantine bank that no agent can see
- [ ] A recall-only connection for agents (writes refused)
- [ ] One bank per project, with tests proving one project can't see another's memory
- [ ] Memory contained to the IDE: nothing from outside enters it, and agents reach it only from inside Towelwise AI
- [ ] Secret patterns filtered before anything is stored
- [ ] What can actually be captured, given agent panels are closed boxes: agent tool calls, vendor hooks or transcripts, IDE activity

**Done when:** a decision record answers three questions: does it run reliably on Windows, does plain retrieval of approved text answer "why" questions well enough (if not, the fallback is the user's own API key), and how does memory get captured? It also says what a fork of Hindsight must change.

---

## Phase 6 — Towelwise Recall

Built into the IDE, and can be turned off.

0. **Fork Hindsight.** Hindsight (MIT) is forked and shaped to recall the way we want, then becomes an official Towelwise component in the codebase. This is real work of its own, and its upkeep counts alongside Code-OSS.
1. **The mailbox.** Review what was captured; approve into project memory or reject and delete. "Allow always for this project" skips the mailbox for people who don't want it.
2. **Agent access.** Agents read approved memory through the recall-only connection and their instruction files.
3. **Export.** A deliberate, one-way copy of memory out to another knowledge bank.
3a. **The dashboard opens anywhere (requirement, owner 2026-11-03).** Any live Recall dashboard must open as an editor tab, come back after a reload, and also be able to sit as a side view, so it can be placed in an editor-grid layout (Phase 4).
4. **The Probability Drive.** The live bottom strip: probable memories appear as dim flickering stars. Click one to jump to that item in the mailbox (dropping out of hyperspace, with *Return to hyperspace* to go back), or leave it for after your session. Hover previews, gentle motion, reduced-motion option.

"Contained" describes Towelwise's memory. Chats still go to each agent's vendor under their terms, and agents keep their own memory.

**Done when:** a full session's worth of memory goes from gathered → reviewed → approved → recalled by an agent, and nothing unapproved ever reaches one.

---

## Phase 7 — Towelwise Guide

Built into the IDE, and can be turned off.

1. **Don't Panic cover and fundamentals library:** short lessons from "what is a branch" to "what does an API key do".
2. **Linked to Recall:** when memory says *why* an agent chose something, the Guide teaches *what* it is.
3. **Your code as the textbook:** lessons link to real examples from your projects.
4. **At your pace:** adaptive lessons through a local model or the user's own key.

**Done when:** a newcomer can go from a decision in Recall to a lesson that explains it, without leaving Towelwise AI.

---

## Phase 8 — DOUG

Offered further down the road, after Hyperspace, Recall and Learning. It's coming, but it isn't one of the core three.

1. **Read-only briefings** built straight from git, approved memory and agent events. The AI only words them.
2. **Cheerful and honest:** bad news first, then the cheer.
3. **Standalone companion app,** so it works with the IDE closed.
4. **Extras, opt-in:** voice, reminders, email, calendar, Pomodoro.
5. **Easter eggs:** Genuine People Personality; FARTS mode.

**Done when:** "Where does this project stand?" gets an answer you'd trust, with nothing invented.

---

## How we work: git

- **Protected `main`.** Always releasable. No direct pushes.
- **Short-lived branches,** one per task, named by type: `feat/layouts-save`, `fix/panel-reopen`, `docs/roadmap`, `site/...`.
- **One worktree per task** when several agents work at once, so they never share a working folder.
- **Small pull requests,** squash-merged, so each lands as one clean commit.
- **Conventional commits:** `feat:`, `fix:`, `docs:`, `chore:`, `copy:`.
- **Stage files explicitly** (no `git add .`), so nothing stray gets committed.
- **Releases** are tagged from `main` (`v0.1.0`) and published from CI.

---

## Strip-down candidates (owner decisions recorded 2026-11-02)

Some choices below are decided and marked so; the rest is open. The idea: Towelwise AI is meant to be a slim IDE for AI agent development that is friendly to newcomers, so look at what Code-OSS ships that the product does not need, and decide area by area.

**How to weigh each one**

- **Do the agents need it?** The agents decide this first. If Claude Code or Codex depend on an area, it stays.
- **Hide before delete.** Every upstream release has to be re-based onto our changes ([0004](docs/decisions/0004-towelwise-ai-is-an-ide-built-from-code-oss-patches.md)). Hiding the way in (menus, shortcuts, panel tabs, default settings) costs little and can be undone. Deleting code touches every file that imports it, and each of those can break on an update.
- **Built-in extensions are cheaper than core code.** Code-OSS bundles 107 extensions (language grammars, Git, GitHub sign-in, Emmet, and so on). Leaving one out of the build is a file removal in `ide/build.sh`, not a patch of core code. Some depend on each other, so each needs checking.
- **Newcomers are a separate question from the owner's habits.** The owner runs terminal commands outside the IDE; a newcomer told by an agent to "run this command" may want to do it inside. That is a product choice, not something the code answers.

**The terminal, as the worked example**

- Claude Code starts its own `claude` process for the chat panel. It uses an IDE terminal only in an optional mode (`claudeCode.useTerminal`, and a command "Claude Code: Open in Terminal"). Losing the terminal would lose that mode.
- Codex has no terminal settings or commands in its manifest and runs its own `app-server` program. It does contain a helper that creates terminals; when it is used was not worked out.
- Read from the code only. Neither agent was run with the terminal removed, which is the real test.
- In VS Code itself, the terminal is used by Tasks, by the debugger's "run in terminal" option, by language extensions that offer "Run file", and by any extension that creates a terminal.

**Candidates**

Sizes are source-code size in the pinned Code-OSS, not the installed app. "Outside importers" counts source files elsewhere that import the area, found by a simple search; it varies by about a factor of two with how you search, so read it as rough tangle, not a precise count.

| Area | What it is | Source size | Outside importers | Do the agents need it? | Cheapest first step |
|---|---|---|---|---|---|
| Terminal | The integrated terminal and its panel | 2.5 MB, 85 files | about 24 to 43 | Not for the chat panels (see above); Codex's helper not confirmed | Hide the entry points; try it for a week |
| Tasks | Run Task, `tasks.json`, build tasks | 0.7 MB, 21 files | about 8 | Not examined | ~~Decided: hide~~ **Shown by default** (revised 2026-11-03); a person may hide it |
| Debug | The debugger and its views | 2.2 MB, 77 files | about 18 | Not examined | ~~Decided: hide~~ **Shown by default** (revised 2026-11-03) |
| Testing | The Testing view and test runners | 1.1 MB, 57 files | about 9 | Not examined | ~~Decided: hide~~ **Shown by default** (revised 2026-11-03) |
| Built-in chat | VS Code's own AI chat views and services | 19.5 MB, 904 files | about 99 | Not examined; separate from the Claude and Codex panels, which are their own extensions | Find which parts are still active in the VSCodium build; hide, do not delete |
| Notebooks | Jupyter-style notebooks and their editors | 4.6 MB, 203 files | about 47 | Not examined | ~~Decided: hide~~ **Shown by default** (revised 2026-11-03); keep the code |
| Source Control | The Git view, diffs, commits | 0.7 MB, 26 files | about 12 | Not examined | **Decided: keep as is.** The owner says it matters even to newcomers (2026-11-02) |
| Remote | Remote and container workspaces | 0.3 MB, 15 files | about 30 | Not examined | Hide the entry points |
| MCP | Model Context Protocol servers view | 1.6 MB, 71 files | about 11 | Likely relevant to agents (not checked) | **Decided: keep.** The owner expects to rely on it later (2026-11-02) |
| Problems, Timeline, Outline, Comments, Search | Smaller side views | each under 1 MB | 1 to 16 | Not examined | Look at once the bigger ones are settled |
| Built-in extensions | 107 bundled extensions | not measured | not applicable | Not examined | List them with what each gives a newcomer; leave out the ones with no use |

**What would settle it**

- Run Towelwise AI for about a week with a chosen set hidden (settings and menus only, no patch) and record what was missed.
- For each area marked "not examined", check whether Claude Code or Codex uses it, by reading their manifests and, where unclear, running them with it off.
- Decide the newcomer question for the terminal and Source Control first, since they are the two with the clearest value to a person new to agent work.

**Decided so far (owner, 2026-11-02):** keep MCP; keep Source Control as is. **Revised 2026-11-03:** the earlier decision to hide Tasks, Debug, Testing and Notebooks is withdrawn. Towelwise is an IDE for people who do not use agents as well, so every built-in menu shows by default (the Towelwise menu is added). The menu hook stays: `towelwise.menus.hidden` ships empty, and a person can list what they want hidden (hiding only removes the way in; the code stays). A picker for choosing what to hide was discussed and set aside as not worth the effort now; time goes to what Towelwise adds.

**Terminal, decided (owner, 2026-11-02):** keep the integrated terminal and hide its user entry points (menu items, panel tab, shortcut, palette commands). In their place, entries that open shells in a normal window outside the IDE, each starting in the project folder: PowerShell and PowerShell (Admin), Command Prompt and Command Prompt (Admin). Further entries approved: Git Bash, and PowerShell 7 and WSL only when installed (WSL needs a Linux distro installed; the owner has WSL without one). Windows Terminal is a window that can host these shells in tabs, not a shell itself; whether to offer it as an entry or as the place the entries open is still open. Only installed shells show, and the list would be editable. Admin entries use Windows' own permission prompt; no elevated shell lives inside the IDE. The entries can be Command Palette commands from the built-in extension with no patch; placing them in the top Terminal menu and hiding the integrated terminal's own entries needs a core patch. How patches are decided is in [0005](docs/decisions/0005-patch-core-only-when-the-extension-cannot.md) (approved).

**Terminal: ideas and facts to weigh**

- The integrated terminal runs a real shell (Windows ConPTY through `node-pty`) as a child of the IDE, so it has the IDE's own permissions: not sandboxed, but also not elevated unless the whole IDE was started as administrator. Each terminal gets IDE variables injected (such as `VSCODE_INJECTION`).
- VS Code already has "Open New External Terminal" (`workbench.action.terminal.openNativeConsole`) and a setting for which Windows terminal it opens (`terminal.external.windowsExec`). That opens a normal window outside the IDE. It has no elevated option.
- An elevated terminal could be a command in the built-in extension that launches PowerShell or Command Prompt "as administrator", which shows Windows' own permission prompt. That needs no core patch. Putting an elevated shell inside the IDE would need an elevated helper process talking to the IDE, which creates a security risk, so an external window is the safer shape. Windows first.
- The owner's idea of a terminal module that can be added to hyperspace is noted and not designed.

**Chat: facts to weigh**

- Claude Code and Codex each already have their own views, separate from VS Code's Chat view: Claude has two activity-bar containers and one in the secondary side bar; Codex has an activity-bar container and one in the secondary side bar. Choose Layout already restores these.
- Codex also registers itself in the built-in Chat view's session list (its manifest declares a chat session type, `openai-codex`). Claude Code's manifest declares none; how it shows up in the Chat picker was not found and may be done in code.
- So the agents do not depend on the Chat view to exist. Hiding the Chat view would remove the shared picker and VS Code's own native chat, not the agents. A Towelwise-owned "Agents" entry that lists installed agents and opens each in its own view could be built in the built-in extension, from the commands Choose Layout already uses, with no core patch. Nothing has been designed.

**Agents: where they open, decided (owner, 2026-11-02):** the owner prefers each agent in its own editor panel, and wants it to be a choice for other users: separate editor panels, or the shared secondary side bar with one tab per agent. Facts behind it:

- Both agents put their main view in the secondary side bar, which draws one tab per view, so opening either one shows a "CLAUDE CODE | CODEX" tab strip. Codex's "Open Codex Sidebar" (`chatgpt.openSidebar`) opens that; Codex's "New Codex Agent" (`chatgpt.newCodexPanel`) opens Codex on its own, as the owner saw it. Whether it is an editor panel was not traced in code.
- Claude Code offers its own ways in: open in a new tab (`claude-vscode.editor.open`), the primary editor (`claude-vscode.primaryEditor.open`), the side bar (`claude-vscode.sidebar.open`), or a new window.
- A Towelwise Agents entry in the built-in extension could offer "Open Claude Code" and "Open Codex", each following one setting for where it opens. No core patch. Not designed: the setting's name and default, how installed agents are found, and whether the VS Code Chat view is hidden at the same time.

**Still open for the owner:** how the hiding is done (the menu hook patch, see 0005, and which areas go first); whether Windows Terminal is an entry or the place the shell entries open; the default for where agents open (editor panels or the side bar), and whether the VS Code Chat view is hidden; whether hiding is enough or some areas should eventually be deleted; and whether built-in extensions get their own pass. Settled and not to be reopened: external shell entries in the Towelwise menu, MCP and Source Control kept. Superseded 2026-11-03: the integrated terminal, Tasks, Debug, Testing and Notebooks are no longer hidden by default.

---

## Open questions, by when they need an answer

| Question | Needed by |
|---|---|
| ~~Weekly hours, so the prototype can be dated honestly~~ Answered 2026-10-31: about 5 to 10 hours a week. Updated 2026-11-03: likely more, but it can drop to zero for days at a time, so each slice should leave the app usable on its own | Done |
| Is the upstream upkeep sustainable at that pace? | Phase 3 |
| Which agents go on the "more agents" list? (Claude Code and Codex are first; Cline, Gemini Code Assist and Kilo Code are candidates once checked) | Phase 4 |
| Does today's layout merge into the hyperspace layout, or stay separate? | Phase 4 |
| What is left of the quiet profile idea, now the whole IDE can be quiet? | Phase 4 |
| When is the first public release, and what does it need? (Signing, an installer, updates, Anthropic's answer on install buttons, OpenAI's terms) | After Phase 4 |
| ~~Does DOUG stay in the core?~~ Answered 2026-10-31: no. Order is Hyperspace and Recall, then Learning, then DOUG later | Done |
| Hindsight on Windows as a shared background service? | Phase 5 |
| What must the Hindsight fork change, and how does it stay current with upstream? | Phase 5 |
| Is no-AI memory enough for "why" questions? | Phase 5 |
| Link approval: user-visible links only, or every internal link? | Phase 6 |
| How corrections and deletions survive reprocessing and restores | Phase 6 |

---

## Promises every phase keeps

1. You drive your AI; Towelwise never does.
2. Vendor rules first, no gray areas.
3. Nothing counts until you approve it.
4. Memory keeps track of *why*.
5. Free and local where it can be.
6. Calm by default. Nothing steals your focus.
7. Cheerful and honest.
8. The tool that grows with you.

*Towelwise AI: mostly helpful.*
