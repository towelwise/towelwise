# Towelwise workflow trial

Start after the October 29, 2026 usage reset at 6 p.m. America/New_York. Run these steps sequentially in `C:\AI Projects\Towelwise AI\Towelwise`.

## 1. Check discovery in both hosts

Open this folder in VS Code and start fresh Claude Code and Codex sessions. In Claude Code, look for `/grill-with-docs`, `/to-spec`, `/handoff`, and `/code-review` in the slash menu. In Codex, look for the same skills in its skill picker; explicit invocation uses `$skill-name`. Other skills, such as `tdd`, can also be selected automatically when the task fits.

Send this in each assistant:

```text
Read AGENTS.md. Confirm tdd and code-review appear in your available skill catalog. Load their installed instructions and report each path and one workflow constraint. Make no application changes. Append one short discovery result to .work/TRIAL.md. If a skill is missing, stop and report the missing skill.
```

If discovery fails, restart the extension/session and retry once. Keep the exact error for troubleshooting. File presence does not prove discovery.

## 2. Agree on the first slice with Claude Code

```text
/grill-with-docs Read ROADMAP.md, focusing on Phase 1 and How we work: git. Help me choose the smallest useful workshop bootstrap slice. Preserve settled decisions and ask only about choices that block this slice, including the tooling and verification boundaries. Account for the empty-extension CI/VSIX acceptance criterion. Do not scaffold yet or create remote resources.
```

Answer the remaining choices. The roadmap does not yet choose a package manager or detailed monorepo tooling.

## 3. Save the spec with Claude Code

```text
/to-spec Save our agreed first slice to .work/specs/phase-1-bootstrap.md. Include observable acceptance criteria, the approved tooling and test boundaries, what we can verify locally, and any remote CI/manual-install steps still pending. Mark it ready only when blocking decisions are settled. Append a short spec milestone to .work/TRIAL.md. Do not implement yet.
```

## 4. Implement the ready spec with Claude Code

```text
Implement only the ready spec in .work/specs/phase-1-bootstrap.md, following AGENTS.md. Use tdd for behavior that needs it and actual build/package smoke checks for the scaffold. Preserve the existing workflow documents. Record the exact project verification commands in AGENTS.md and append commands, results, and pending checks to .work/TRIAL.md. Leave the work uncommitted for Codex's review. Stop before remote setup, publishing, or installing the VSIX into my editor.
```

Local Git initialization and a task branch can be part of the agreed bootstrap. Do not confuse a successful local package with a passing remote CI run or a verified manual installation.

## 5. Review with Codex

```text
$code-review Review the current implementation against .work/specs/phase-1-bootstrap.md and the relevant Phase 1 roadmap criteria. Include staged, unstaged, and untracked source/configuration files. Report bugs, security issues, edge cases, and missing meaningful tests in severity order. Do not change implementation files. Append a short review result, scope, and verification gaps to .work/TRIAL.md.
```

If findings need changes, take them back to Claude, fix the confirmed issues, and rerun the relevant checks. Request another focused review when warranted.

## 6. Leave a handoff with Claude Code

```text
/handoff Save the current status to .work/HANDOFF.md so Codex or a fresh Claude session can continue. Link the active spec, decisions, trial results, review findings, exact verification commands, and remaining Phase 1 work. Separate local checks from remote CI and manual VSIX installation. Do not mark the whole phase complete unless its actual acceptance criteria are verified.
```

## Bring back the evidence

Return to the Skills workspace and ask: "Evaluate the Towelwise workflow trial. Read .work/TRIAL.md, .work/HANDOFF.md, the active spec, and the relevant diff in C:\AI Projects\Towelwise AI\Towelwise. Check discovery, scope, review coverage, verification evidence, and unnecessary usage."

These trial artifacts are intentionally small. Record failures and skipped checks honestly; the first trial can reveal improvements without being considered a complete Phase 1 delivery.
