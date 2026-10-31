# Phase 1 bootstrap: empty core extension

Status: ready-for-agent

## Goal

First slice of ROADMAP.md Phase 1 ("Set up the workshop"). It works toward the Phase 1 acceptance criterion: "an empty extension builds in CI and installs from the packaged `.vsix`". This slice covers the local half: one empty extension that lints, tests and packages locally, plus a CI workflow file that runs the same checks.

## Acceptance criteria

1. The project folder is a local Git repository (`git init`, no remote). It has a `.gitignore`, an Apache 2.0 `LICENSE` and a `NOTICE`. The existing workflow documents (`AGENTS.md`, `CLAUDE.md`, `ROADMAP.md`, `docs/WORKFLOW-TRIAL.md`, `.work/`) are kept unchanged, except for the AGENTS.md Verification section in item 5.
2. An npm workspaces root contains one package: the core extension, identifier `towelwise.towelwise`. Activating it does nothing else.
3. These all run from the repo root and exit 0: install, lint, typecheck/build, test and package. Packaging produces a `.vsix` file.
4. A GitHub Actions workflow runs on pull requests and calls the same root commands as the local checks. In this slice it is written but not run.
5. The AGENTS.md "Verification" section records the exact lint, test, typecheck, build/package commands and the `.vsix` output path.
6. `.work/TRIAL.md` gets a new entry with the commands, their actual exit status, and the checks still pending.

## Approved decisions (user, 2026-10-29, grilling session)

- Package manager: npm workspaces.
- Toolchain: TypeScript compiled with `tsc`, no bundler; ESLint; VS Code extension tests (`@vscode/test-cli` / `@vscode/test-electron`).
- Verification boundary: local checks plus a workflow file. Creating the remote, running CI and installing the VSIX are separate requests.
- Settled by the roadmap: publisher `towelwise`, Apache 2.0, one repo with separate packages, CI on PRs (lint, tests, `.vsix`), conventional commits, explicit staging.

There are no decision records yet. None of these choices required one.

## Verification

- **Test seam (approved):** one VS Code extension test. It starts VS Code with the extension loaded, then asserts that `towelwise.towelwise` is present and activates without error. There are no other behavior tests, because the extension has no behavior yet.
- **Smoke checks:** lint, `tsc`, and the package step (`vsce package`) exit 0, and the `.vsix` file exists at the recorded path.
- **Manual / pending:** CI run on GitHub; installing the `.vsix` into VS Code. Neither is part of this slice.

## Implementer defaults (approved by the user, 2026-10-31)

- Package path `packages/towelwise/`.
- The `engines.vscode` floor, `^1.90.0`, and the Node version pin in CI, Node 22. The floor was untested until the same day; CI now has a `min-vscode` job that runs the whole test suite on VS Code 1.90.0 (set through the `VSCODE_TEST_VERSION` variable in `.vscode-test.mjs`). Keep that version in step with `engines.vscode`.
- CI runner `ubuntu-latest` with `xvfb-run` for the headless VS Code test.
- Packaging with `vsce package --no-dependencies` (the extension has no runtime dependencies); the `--allow-missing-repository` flag was dropped once the `repository` field was added.

## Out of scope

- Recall, Guide and extension-pack packages.
- README, CONTRIBUTING, code of conduct, issue/PR templates.
- `docs/decisions/` (created with the first real decision record).
- Remote repo creation, branch protection, pushing, publishing, installing the VSIX.
- Committing (leave uncommitted for Codex review).
- Any Phase 2 feature.

## Unresolved / external prerequisites

- Whether the VS Code test runs headless on GitHub runners is unverified until CI runs (requires remote, separate request).
- Open VSX namespace verification (Phase 0) is still pending; it doesn't block this slice.
