# Handoff to Claude Code

Date: 2026-10-29. Updated by Codex after the Phase 2 hyperspace spec review.

## Task and current status

**Update (Claude Code, 2026-10-29):** the user resolved findings 1-4 below. Areas hyperspace closes stay closed on restore; workspace overrides hide the rest and name the blocking setting; one shared hyperspace across windows with a write-once snapshot; round-trip test extended with set/unset/override cases. The spec is revised and back to `ready-for-agent`. Implementation not started.

The current task was to review `.work/specs/phase-2-hyperspace.md`, not implement it. The spec still says `Status: ready-for-agent`; Codex recommended returning it to draft until findings 1-3 below are resolved. The user has not yet accepted a resolution or requested implementation. Extension source remains the empty bootstrap with one activation test.

Claude's next assignment: discuss the blocking choices with the user and revise the spec to reflect agreed answers before implementation. Preserve the approved area-based model, hyperspace-first order, dropped agent buttons, command/keybinding trigger, and explicit recovery offer. Do not independently replace the approved global-settings scope.

## References

- Instructions: [AGENTS.md](../AGENTS.md) and [CLAUDE.md](../CLAUDE.md).
- Roadmap: [ROADMAP.md](../ROADMAP.md), Phase 2 slice 1. The working copy reorders hyperspace first and removes agent buttons.
- Active spec: [phase-2-hyperspace.md](specs/phase-2-hyperspace.md). Terms: [GLOSSARY.md](../GLOSSARY.md).
- Previous spec: [phase-1-bootstrap.md](specs/phase-1-bootstrap.md).
- Decisions: `docs/decisions/` does not exist yet; approved choices are recorded in the spec. Do not create a decision record without an actual approved trade-off.
- Prior evidence: [TRIAL.md](TRIAL.md). Its earlier "bootstrap implementation is absent" finding is historical and superseded by the implementation and review below.
- Current review findings: [this handoff](#review-findings); the spec review was originally delivered in chat, with no separate findings file.

## Git state

- Branch: `docs/spec-hyperspace`.
- Baseline HEAD: `75a1920ec596260abc1b4f1e432a2bdb1a7919eb` (`docs: mark Phase 1 done except decision records (#4)`). Remote `origin` exists.
- Before this handoff update: modified `ROADMAP.md`; untracked `.work/specs/phase-2-hyperspace.md` and `GLOSSARY.md`. No staged changes were shown.
- This handoff update is also uncommitted. The earlier handoff's unborn-branch/no-remote state is obsolete.

## Review findings

Codex reviewed the spec, related roadmap diff, glossary, current scaffold, installed VS Code API types, and official VS Code documentation. No files were changed during the review and no tests were run for this proposed feature.

1. **P1 - Prove exact area visibility restoration** (spec lines 14, 42-44). User-setting snapshots do not record whether a sidebar or bottom panel was open. The installed public API has no sidebar/panel visibility reader; [upstream request #283331](https://github.com/microsoft/vscode/issues/283331) was open when checked. Blind toggles can open an already-hidden area. Demonstrate a supported method, or agree a narrower guarantee; this cannot remain an implementer default.
2. **P1 - Define workspace-override behavior** (lines 14, 26). A workspace setting such as `workbench.statusBar.visible: true` can defeat a global `false`. [VS Code settings precedence](https://code.visualstudio.com/docs/configure/settings#_settings-precedence) confirms workspace values override user values. Ask the user to choose the behavior when this prevents hiding: reject with an explanation, accept partial hiding, or approve a different scope.
3. **P1 - Define multi-window session ownership** (line 26). A enters and saves "unset"; B enters afterward and saves "hidden". A restores, then B restores: the original unset value is lost. The accepted cross-window visibility side effect does not resolve this. Decide whether only one window may own hyperspace and how other windows handle commands and recovery.
4. **P2 - Expand meaningful verification** (line 35). The default round trip can pass while persisted recovery and optional area choices are broken. Propose recovery coverage, explicit set/unset fixtures, and an optional-area case for initially open/closed states once finding 1 is resolved. The approved test seam currently remains only one real VS Code round trip; any expansion is a review recommendation, not an approved change.

Keybinding, settings/commands, restore-state storage, and area restoration remain unapproved implementer defaults in the spec. No architectural solution was selected by Codex.

## Historical bootstrap verification by Codex

Preserved from the previous handoff; these checks were not rerun for the Phase 2 spec review. Commands ran from the repo root on Windows, Node 24.18.0 / npm 11.16.0.

| Command | Exit | Result |
| --- | --- | --- |
| `npm.cmd run lint` | 0 | ESLint passed. |
| `npm.cmd run build` | 0 | TypeScript compiled. |
| `npm.cmd test` in sandbox | 1 | Network access failed; cached VS Code then failed during Electron startup because of sandbox permissions. The activation test did not run. |
| `npm.cmd test` outside sandbox | 0 | One activation test passed on VS Code 1.144.0. |
| `npm.cmd run package` | 0 | Produced `packages/towelwise/towelwise.vsix`. |

Plain `npm run lint` and `npm run build` initially exited 1 because PowerShell blocks `npm.ps1`; using `npm.cmd` resolved the launcher issue without changing execution policy. VSIX inspection confirmed five archive entries, compiled `out/extension.js`, and identity `towelwise.towelwise` version `0.0.1`. Git status was unchanged after review.

Codex did not rerun a clean `npm ci`. Claude's earlier successful install and checks are reported separately in TRIAL.md; they are not fresh Codex verification.

## Pending work and next action

Smallest next action: resolve finding 1's feasibility and the user's choices for findings 2-3, then update the spec and agreed verification. Do not implement dependent work while these choices remain open. The handoff request authorizes this document update, not commits, pushes, publishing, or editor installation.

- Current `ROADMAP.md` marks Phase 1 done except `docs/decisions/`. Earlier handoff entries describing CI/manual VSIX checks as pending are historical; this spec review did not independently verify their later completion.
- Hyperspace runtime behavior, restart recovery, optional area controls, Linux/headless CI, and macOS menu-bar behavior remain untested. See the spec's verification/prerequisites sections.
- Open VSX verification was pending in the bootstrap spec; its current status was not rechecked. Claude starter-skill discovery/execution evidence was also unestablished in the older trial record; do not claim completion from file existence.
- Bootstrap defaults (package path, VS Code floor, CI Node/runner, and packaging approach) were flagged in the previous review, with no user approval captured in this conversation.
- For this handoff, `git status --short`, `git branch --show-current`, `git rev-parse --verify HEAD`, `git log -1 --format=%s`, `git diff --stat`, `git diff --cached --stat`, `git remote`, and targeted file reads completed successfully. They establish local state, not feature correctness.
- TRIAL.md and the spec were left unchanged. Current review evidence is recorded here.

Suggested skills: `grill-with-docs` for unresolved next-slice choices, `to-spec` before substantial implementation, `diagnosing-bugs` if a real check fails, `code-review` for the next independent review, and `handoff` when transferring work. Discover them in the receiving host; do not assume availability. Use `tdd` for agreed behavior, and smoke checks for scaffolding.
