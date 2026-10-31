# Phase 3: First build of Towelwise AI

Status: ready-for-agent

## Goal

Phase 3 of ROADMAP.md, the first milestone after the pivot in [decision 0004](../../docs/decisions/0004-towelwise-ai-is-an-ide-built-from-code-oss-patches.md). Produce a real Towelwise AI app for Windows from our own pipeline, with today's hyperspace, layout and walkthrough built in and no Towelwise core patches, and prove two things: agents install and sign in on it, and absorbing an upstream release is affordable. Terms follow [GLOSSARY.md](../../GLOSSARY.md).

This milestone adds almost no features on purpose. It separates learning the build from the riskier layout patch in Phase 4.

## Acceptance criteria

1. One documented command in this repo builds a runnable Windows app of Towelwise AI from a pinned upstream Code-OSS version, using scripts and patches derived from VSCodium, with its MIT notice kept.
2. The app has its own identity: the name Towelwise AI, its own icon (a placeholder is fine), application id, data folder and URL scheme. It runs side by side with VS Code without reading or changing VS Code's settings or extensions. No Microsoft or VS Code branding appears in its name.
3. Its extension store is Open VSX, and telemetry is off as in VSCodium.
4. `packages/towelwise` ships inside the app as a built-in extension. With nothing installed, Jump to Hyperspace, Choose Layout, Restore Layout, the Output log and the walkthrough all work.
5. No patch of ours changes workbench or layout behaviour. Patches are limited to what the build and identity need.
6. On the built app, Claude Code and Codex install from Open VSX, sign in fresh with empty config folders, chat, edit a file, and come back after a window reload. The result records whether the browser returned to the app by itself, which depends on the new URL scheme.
7. The update process is written down and has been used once for real: move the pin to a newer upstream version, fix what breaks, rebuild, and record how long it took and what broke.
8. Root `npm run lint`, `npm run build`, `npm test` and `npm run package` still exit 0, and CI passes on the PR.

## Approved decisions (user, 2026-10-31, grilling session)

- Towelwise AI is an IDE built VSCodium-style, as patches on upstream. UI changes stay careful, for the most control with the least conflict ([0004](../../docs/decisions/0004-towelwise-ai-is-an-ide-built-from-code-oss-patches.md)).
- The extension is not released; its code becomes the built-in extension.
- Windows first.
- The repo stays public.
- Recall, Guide and DOUG will ship built in, each able to be turned off, as separate packages in this repo.
- This milestone is a branded build with no core patches. The layout editor is the next milestone.
- No agent is bundled.

Decisions for later phases, recorded in ROADMAP.md: proportional sizes first, a locked hyperspace layout with a notification that opens a dismissable hovering window, default keys from the start, a review mailbox with an "allow always for this project" option, and "works with" wording with install buttons on the first-run screen.

## Verification

- **Smoke checks (scaffolding, no invented behaviour tests):** the build command exits 0 and produces the app; the app launches with its own title and data folder; `product.json` shows the Open VSX gallery and the Towelwise identity.
- **Existing tests:** the extension's test suite keeps passing as it does today.
- **Manual (the owner, Windows):** criteria 2, 4 and 6 on the built app. Use empty `CLAUDE_CONFIG_DIR` and `CODEX_HOME` folders for the fresh sign-in, and clear `ELECTRON_RUN_AS_NODE` and `VSCODE_*` when launching from inside VS Code, or the app exits immediately. Check real credential files by fingerprint only.
- **Measured:** build time, app size, and the time spent on the upstream update in criterion 7.

Build success, CI, launch and manual sign-in are separate results. None proves the others.

## Implementer defaults (not approved; flag in review)

- Where the scripts and patches live in the repo, and the upstream version pinned first.
- The application id, data folder name and URL scheme, such as `towelwise-ai`.
- A zip or portable build first, with no installer.
- Building locally first, and whether CI builds at all in this milestone. A public repo's runners are free, but build time and limits are unmeasured.
- How much of VSCodium's patch set to keep, and how the built-in extension is added to the build.

## Out of scope

- The layout editor, locked hyperspace and any core layout patch (Phase 4).
- The first-run agent screen and changes to the walkthrough or README wording.
- Memory, MCP, the mailbox, Recall, Guide and DOUG.
- macOS and Linux builds.
- Code signing, an installer, auto-update and any public release.
- Publishing the extension, and retiring the CI `min-vscode` job.

## Unresolved / external prerequisites

- Whether fresh sign-in works under our own URL scheme. VSCodium passed, but its scheme is its own, and Codex's bundle has one hardcoded `vscode://` mention.
- Whether a full build fits this Windows machine and the time available.
- Before any public release: Anthropic's answer on install buttons, a read of OpenAI's terms, and code signing, since an unsigned Windows app triggers warnings.
- Tools needed to build, per VSCodium's docs: Git Bash, Node at the pinned version, jq, Python 3.11, rustup, 7-Zip, plus Windows build tools. None has been checked on this machine yet.
