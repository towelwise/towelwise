# Towelwise agent workflow

Read this file in both Claude Code and Codex. The roadmap is `ROADMAP.md`.

## Roles and scope

- Claude Code is the primary implementer. Codex reviews, challenges plans, and handles explicitly scoped tests or mechanical tasks. Gemini/Antigravity provides advisory and UI help.
- Start with Phase 1 of the roadmap. Its acceptance criterion is an empty extension that builds in CI and installs from a packaged VSIX. The full phase can be divided into smaller agreed slices.
- Preserve approved roadmap decisions. Propose unresolved architecture, package-manager, workspace, and tooling choices for the user to decide before implementing dependent work.
- This folder starts with workflow documents only. Preserve them when scaffolding. Application code and build commands have not been created or verified yet.

## Shared skills

The starter catalog is `grill-with-docs`, `grilling`, `domain-modeling`, `codebase-design`, `to-spec`, `tdd`, `diagnosing-bugs`, `handoff`, and `code-review`.

Claude Code's copies are in `~/.claude/skills/`. Codex's copies are in `~/.agents/skills/`. Use the host's skill discovery/invocation mechanism. Report the actual skill name and installed path when using one during the trial. If it is absent from the catalog, report that discovery failed instead of silently substituting general advice.

- Discuss unclear work with `grill-with-docs`; focus questions on the current slice.
- Use `to-spec` to save agreed work before substantial implementation.
- Use `tdd` for meaningful behavior at agreed public boundaries. For scaffolding, run actual lint/build/package smoke checks; do not invent behavior or tautological tests merely to satisfy TDD.
- Use `diagnosing-bugs` when a failure requires investigation.
- Use `code-review` in Codex for the independent review, including untracked initial files.
- Use `handoff` when switching agents or ending a session that leaves work to continue.

## Project artifacts

- Issue tracker for this local workflow trial: Markdown specs in `.work/specs/`. Use `.work/specs/phase-1-bootstrap.md` for the first slice. A ready spec has `Status: ready-for-agent`; unresolved specs remain draft. Local status text replaces external issue labels during the trial.
- Decisions: `docs/decisions/`, as required by the roadmap. Create a decision record only for an actual approved trade-off.
- Glossary: root `GLOSSARY.md`, created when the first useful domain term is resolved.
- Handoff: `.work/HANDOFF.md`, with links to the active spec and review findings.
- Trial evidence: `.work/TRIAL.md`. After each trial milestone, append a short entry with assistant, date, skill/path, artifact or reviewed scope, commands and actual results, and any pending check. Codex may write this evidence file when the trial prompt requests it; otherwise reviews keep files unchanged.
- Usage guide and copyable prompts: `docs/WORKFLOW-TRIAL.md`.

These paths apply to this project. The global skills should honor each project's own configured paths.

## Work discipline

- Work in one agent at a time in this folder. Concurrent implementers need separate worktrees, as the roadmap specifies.
- Read narrowly. Use medium reasoning by default. Ask one targeted question about a blocking ambiguity. Use additional agents only when the user explicitly requests them.
- Match the current agreed slice. Keep Phase 2 product features and later memory experiments out of Phase 1 scaffolding.
- Leave implementation uncommitted for the second opinion unless the user requests a commit. Follow the roadmap's task branches, conventional commits, explicit staging, small PRs, and protected-main rules when Git work is requested.
- Local specs do not authorize creating remote repositories, changing branch protection, pushing, publishing, or installing a VSIX into the user's editor. Identify these as separate Phase 1 actions for the user to request.
- After two failed attempts at the same fix, report the attempts and ask the user.

## Verification

Toolchain: npm workspaces, TypeScript (`tsc`, no bundler), ESLint, `@vscode/test-cli`. Run from the repo root:

- Install: `npm ci`
- Lint: `npm run lint`
- Typecheck/build: `npm run build`
- Test: `npm test` (downloads VS Code into `packages/towelwise/.vscode-test/` on first run; CI wraps it in `xvfb-run -a`)
- Package: `npm run package` → `packages/towelwise/towelwise.vsix`

`@vscode/test-electron` must stay at 3.x or newer: 2.x splits launch paths on spaces on Windows (this folder's path contains spaces).

After behavior-changing work, run the relevant checks. Record command, exit status, and any missing dependency. Keep build/package verification, CI execution, and manual VSIX installation as distinct results. Do not claim one proves the others.

The trial succeeds when both hosts discover the same starter skills, Claude works from the agreed spec, Codex reviews the actual changes, and recorded checks show what passed and what remains pending. A local file check alone does not establish host discovery or product correctness.
