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
| 3 | **First build** of Towelwise AI | Next |
| 4 | **The layout editor** and locked hyperspace | — |
| 5 | The memory experiment (Hindsight on Windows) | Can run alongside Phase 4 |
| 6 | **Towelwise Recall**: the mailbox, then the Probability Drive | — |
| 7 | **Towelwise Guide**: fundamentals library first | — |
| 8 | **DOUG**: once there's memory worth briefing from | — |

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

- [ ] Build scripts and patches on upstream Code-OSS, starting from VSCodium's
- [ ] Its own name, icon and data, side by side with VS Code
- [ ] Open VSX as its store; telemetry off
- [ ] Phase 2's code built in
- [ ] Claude Code and Codex install, sign in fresh, and work
- [ ] One real upstream update done and timed

**Done when:** you can run the app daily, and an upstream update has been done and measured, so we know whether the upkeep is sustainable.

---

## Phase 4 — The layout editor

The first core patch, kept small and careful. This is the headline feature: your UI, your way.

1. **Layout mode.** A visible box over every part of the window. Turn each on or off, and set its width and height.
2. **Save as your hyperspace layout.** Sizes are proportions at first, so they carry across screens.
3. **Locked hyperspace.** While it's on, the window holds to your layout and no other way. Anything that wants to open shows a notification instead; click it and it opens in a hovering window you can dismiss.
4. **Default keys** for going in and out of hyperspace, with more to come. Today's defaults are `Alt+Shift+J` and `Alt+Shift+L`.
5. **Works for anyone:** agents, plain text editing without AI, folder lists, whatever they choose.
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

Built into the IDE, and can be turned off.

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

## Open questions, by when they need an answer

| Question | Needed by |
|---|---|
| ~~Weekly hours, so the prototype can be dated honestly~~ Answered 2026-10-31: about 5 to 10 hours a week | Done |
| Is the upstream upkeep sustainable at that pace? | Phase 3 |
| Which agents go on the "more agents" list? (Claude Code and Codex are first; Cline, Gemini Code Assist and Kilo Code are candidates once checked) | Phase 4 |
| Does today's layout merge into the hyperspace layout, or stay separate? | Phase 4 |
| What is left of the quiet profile idea, now the whole IDE can be quiet? | Phase 4 |
| When is the first public release, and what does it need? (Signing, an installer, updates, Anthropic's answer on install buttons, OpenAI's terms) | After Phase 4 |
| Does DOUG stay in the core, given the product is defined by Hyperspace, Recall and Learning? | After Phase 6 |
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
