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

## Implementer defaults (approved by the user, 2026-10-31)

- Scripts and patches live in a top-level `ide/` folder: `ide/build.sh`, `ide/patches/`, a `product.json` overlay, and a small file recording the pinned upstream version. The first pin is VSCodium 1.143, where the sign-in evidence was gathered, so a newer release is the target for criterion 7.
- Identity: name `Towelwise AI`; application and URL scheme `towelwise-ai`; data folder `.towelwise-ai`; a new Windows app id. The built-in extension keeps its id `towelwise.towelwise`.
- A portable zip first, with no installer.
- Local builds only in this milestone, with no CI build. Decide on CI after the first run gives real build time and size.
- Start with VSCodium's whole patch set and drop a patch only when it breaks something; add none of our own beyond identity. The built `packages/towelwise` is copied into the app's built-in extensions during the build, not added by a patch.

## Results so far (owner's Windows machine, 16 GB RAM, 12 logical CPUs)

- **Build (criterion 1):** `ide/build.sh` built the app from VSCodium `1.143.17232` (Code-OSS 1.143.1) with the machine otherwise idle. First run 2026-10-31: about 14 minutes (extension pack 36 s, source fetch 27 s, compile 12 min, zip about 1 min). Rebuild 2026-11-01 with the title-bar slice and the picker: about 13 minutes, including the zip step run end to end. App folder 993 MB, portable zip 289 MB.
- **Identity, store, built-in extension (criteria 2 to 4):** the owner reported the identity and built-in extension checks good on 2026-10-31, and on 2026-11-01 reported hyperspace, the title-bar change and the picker working in the rebuilt app. The Open VSX gallery and identity fields were also read from the built `product.json`.
- **Fresh sign-in (criterion 6):** Claude Code and Codex installed and signed in on the built app (owner-reported). Observed: the browser did not return to the app by itself, and the owner switched back by hand; the sign-in pages end on a success page that says to return to the application (2026-11-01). Checked: Windows has `towelwise-ai://` registered to `Towelwise AI.exe --open-url`, and Codex's `vscode://codex/` string is an internal prefix between its panel and extension, not a browser redirect. **Unverified:** how each agent's sign-in callback works, what plain VS Code does (the owner does not remember), and whether a live `towelwise-ai://` link hands off to the app. Whether this is expected behaviour or a defect is not settled.
- **Not done:** criterion 7 (a real upstream update; VSCodium had no 1.144 tag on 2026-10-31), CI, macOS.
- **Icon:** the owner supplied their own image (`ide/icons/towelwise.png`) and title-bar logo (`ide/icons/code-icon.svg`). The build copies a generated Windows executable icon and tiles (made transparent from the picture's dark background by `ide/icons/make_icons.py`), and the logo, over VSCodium's. **The app built on 2026-11-01 (`1.143.17336`) predates this and still has VSCodium's icon, tiles and title-bar logo; the next build should have the new ones, unverified until the owner sees it, including on light themes.** The editor watermark and file-type icons remain VSCodium's either way.

## Out of scope

- The layout editor, locked hyperspace and any core layout patch (Phase 4).
- The first-run agent screen and changes to the walkthrough or README wording.
- Memory, MCP, the mailbox, Recall, Guide and DOUG.
- macOS and Linux builds.
- Code signing, an installer, auto-update and any public release.
- Publishing the extension, and retiring the CI `min-vscode` job.

## Unresolved / external prerequisites

- Whether fresh sign-in works under our own URL scheme. VSCodium passed, but its scheme is its own, and Codex's bundle has one hardcoded `vscode://` mention.
- Whether a full build fits this Windows machine and the time available (16 GB RAM, 12 logical CPUs, 401 GB free on 2026-10-31).
- Before any public release: Anthropic's answer on install buttons, a read of OpenAI's terms, and code signing, since an unsigned Windows app triggers warnings.
- Build tools, checked on this machine 2026-10-31: Git Bash, Node 24.18.0 (VSCodium's master `.nvmrc`; recheck at the pinned commit), Python 3.11.9, rustup, 7-Zip (now on PATH), jq 1.8.2 (installed), and Visual Studio Build Tools 2022 with ATL and Spectre libraries (added). Long paths are on in Windows and git. Launch the build with Git Bash by full path, since `bash` on PATH is the empty WSL stub. The ATL and Spectre requirement is from VS Code's wiki, from memory, not confirmed by a build.
