# Towelwise AI — Roadmap

> A suite of plugins and applications designed to keep you all-knowing in your projects.
> *Don't Panic.*

Updated October 27, 2026 · Johnny T

This is the working roadmap: the order things get built, and what "done" means for each step. Dates come after the first prototype, from real hours rather than guesses.

---

## The plan at a glance

| Phase | What | Status |
|---|---|---|
| 0 | Claim the names | Done, Open VSX verification pending |
| 1 | Set up the workshop | Next |
| 2 | First prototype: **Towelwise** (sidebar, layouts, hyperspace, beginner profile) | — |
| 3 | The memory experiment (Hindsight on Windows) | Can run alongside Phase 2 |
| 4 | **Towelwise Recall**: approval inbox, then the Probability Drive | — |
| 5 | **Towelwise Guide**: fundamentals library first | — |
| 6 | **DOUG**: once there's memory worth briefing from | — |

The guiding rule: **a small, real prototype in weeks, not a finished suite in 2027.**

---

## Phase 0 — Claim the names

- [x] `towelwise` GitHub organization
- [x] `towelwise/.github` org profile README
- [x] `towelwise.github.io` site, live on GitHub Pages
- [x] VS Code Marketplace publisher `towelwise`
- [ ] Open VSX namespace `towelwise`: Eclipse account and Publisher Agreement done; verification claim pending (EclipseFdn/open-vsx.org #14818)
- [x] License: Apache 2.0

**Done when:** every name is held, and the license is picked so the first repo can include it.

---

## Phase 1 — Set up the workshop

- [ ] Main code repo (e.g. `towelwise/towelwise`) holding the three extensions and the extension pack as separate packages
- [ ] Apache 2.0 `LICENSE` and `NOTICE`, README, `CONTRIBUTING.md`, code of conduct, issue and PR templates
- [ ] Protected `main`: changes only through pull requests, checks must pass
- [ ] CI on every pull request: lint, tests, and package a `.vsix` to prove it builds
- [ ] `docs/decisions/` for short decision records (one page each: the choice, why, what was ruled out)
- [ ] `CLAUDE.md` / `AGENTS.md` in the repo so every agent follows the same house rules

**Done when:** an empty extension builds in CI and installs from the packaged `.vsix`.

---

## Phase 2 — First prototype: Towelwise

The core extension, built in small slices. Each slice ships on its own.

1. **Sidebar with agent buttons.** One colored button per installed AI extension (Claude Code, Codex, others) that opens its official panel. Missing agents offer an install. Buttons only open panels; never a prompt.
2. **Saved layouts.** Save how your agents are arranged and bring it back with one click, in any project. Reopen a panel that a reload or update lost.
3. **Jump to hyperspace.** One click hides everything but your agents; one more restores it all.
4. **Beginner profile.** A quiet ready-made VS Code profile and a first-run walkthrough. Your normal setup stays untouched.

**Done when:** you use it every day on your own three-agent layout and it survives reloads and extension updates.

**First public release:** a `0.x` pre-release on the Marketplace and Open VSX.

---

## Phase 3 — The memory experiment

A spike that answers whether Recall's memory works the way the vision says, before building any UI for it.

- [ ] Hindsight running on Windows as a small local service
- [ ] Storing approved text as-is, with no AI model (chunks mode); observations off
- [ ] Background codebase survey and auto-injection turned off, so no hidden AI runs
- [ ] A quarantine bank that no agent can see
- [ ] A recall-only connection for agents (writes refused)
- [ ] One bank per project, with tests proving one project can't see another's memory
- [ ] Secret patterns filtered before anything is stored

**Done when:** a decision record answers two questions: does it run reliably on Windows, and does plain retrieval of approved text answer "why" questions well enough? If not, the fallback is the user's own API key.

---

## Phase 4 — Towelwise Recall

1. **The approval inbox.** Review what Hindsight gathered after each run; approve into project memory or reject and delete.
2. **Agent access.** Agents read approved memory through the recall-only connection and their instruction files.
3. **The Probability Drive.** The live bottom strip: probable memories appear as dim flickering stars. Click one to jump to that item in the inbox (dropping out of hyperspace, with *Return to hyperspace* to go back), or leave it for after your session. Hover previews, gentle motion, reduced-motion option.

**Done when:** a full session's worth of memory goes from gathered → reviewed → approved → recalled by an agent, and nothing unapproved ever reaches one.

---

## Phase 5 — Towelwise Guide

1. **Don't Panic cover and fundamentals library:** short lessons from "what is a branch" to "what does an API key do".
2. **Linked to Recall:** when memory says *why* an agent chose something, the Guide teaches *what* it is.
3. **Your code as the textbook:** lessons link to real examples from your projects.
4. **At your pace:** adaptive lessons through a local model or, with consent, VS Code's language models on your Copilot plan.

**Done when:** a newcomer can go from a decision in Recall to a lesson that explains it, without leaving VS Code.

---

## Phase 6 — DOUG

1. **Read-only briefings** built straight from git, approved memory and agent events. The AI only words them.
2. **Cheerful and honest:** bad news first, then the cheer.
3. **Standalone companion app,** so it works with VS Code closed.
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
| Weekly hours, so the prototype can be dated honestly | After Phase 2 starts |
| Which agents first? (Claude Code, Codex, Copilot are clear; check Google's terms for Antigravity/Gemini) | Phase 2 |
| Where the Towelwise sidebar goes in hyperspace when all side areas hold agents | Phase 2 |
| Hindsight on Windows as a shared background service? | Phase 3 |
| Is no-AI memory enough for "why" questions? | Phase 3 |
| Link approval: user-visible links only, or every internal link? | Phase 4 |
| How corrections and deletions survive reprocessing and restores | Phase 4 |
| Copilot free plan: does language model access work, and how much? | Phase 5 |

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
