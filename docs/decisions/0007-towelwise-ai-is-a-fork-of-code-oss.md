# Towelwise AI is a fork of Code-OSS, and Towelwise is core code

Status: approved by the owner (2026-11-06). Supersedes [0004](0004-towelwise-ai-is-an-ide-built-from-code-oss-patches.md) and [0005](0005-patch-core-only-when-the-extension-cannot.md).

This is the last decision of this repository. It closes the extension-and-patches way of building Towelwise AI; development continues as a new product in [towelwise/towelwise-production](https://github.com/towelwise/towelwise-production), with its own roadmap and decisions, starting from what is recorded here.

0004 kept Towelwise in a built-in extension with a few core patches, and 0005 sent every change to the extension first. In practice most of the product (the layout, the menus, hiding built-in areas) needed core, and the extension reached it through bridge commands and workarounds. The owner chose to stop working around core and edit it directly, and accepts the upkeep that brings.

**The decision**

- Towelwise AI's source is our own fork of `microsoft/vscode`: a normal repository with Microsoft's code and an `upstream` remote, not a GitHub fork (a GitHub fork stays tied to Microsoft's repository and can open pull requests against it by mistake).
- VSCodium's build scripts stay on top, pinned to a tag, for branding, telemetry removal and Open VSX. Only their step that clones Code-OSS is replaced by our fork.
- Towelwise features live in their own folder, `src/vs/workbench/contrib/towelwise/`, because new files never conflict with upstream. That is a habit, not a limit: when the right change is in Microsoft's code, we change it there.
- One repository holds everything: the fork, plus our docs and build scripts in a top-level `towelwise/` folder.
- The new repository is `towelwise/towelwise-production` (local folder `C:\AI Projects\Towelwise Production`). This extension repository keeps its name and is archived. The fork first carries the extension's source as a bundled extension in `extensions/towelwise/`, so the app works as before; then each feature moves into `contrib/towelwise/` with its tests rewritten as core unit tests, and leaves the extension. The menu hook moves first, the layout last.
- The fork starts at the Code-OSS commit our pinned VSCodium tag uses (`1.143.17232`, `e646868`), so its first build matches the extension-based app. Newer upstream is the first merge after the port.
- The port keeps every `towelwise.*` setting and command ID and the saved-layout format unchanged, so a person's settings, keys and saved layout survive the switch. Renaming any of them is a separate decision.
- Microsoft's root `AGENTS.md` stays, with a short Towelwise section at its top pointing to `towelwise/AGENTS.md`; a root `CLAUDE.md` does the same.
- Upstream releases are taken when we choose. VSCodium's update feed stays off (`DISABLE_UPDATE=yes`); our own update feed is release work.

**Ruled out**

- **A patch overlay** (our code copied in at build time, edits to Microsoft's files kept as `.patch` files). Same conflicts as a fork on upstream updates, but large edits as patch files are hard to change and review.
- **Two repositories** (scripts and docs apart from the fork), as VSCodium does. Every feature would span two repositories.
- **Forking VSCodium's setup and owning all of it.** More to own from day one, for nothing we need yet.

**Consequences**

- Upstream merges are ours. Their cost depends on how many of Microsoft's files we edit, so edits to them stay deliberate.
- Pull-request checks compile the editor and run our tests in it, which takes longer than the extension's checks. The full app build stays a release step.
- Staying on one upstream version too long misses Electron and Chromium security fixes. A limit on how far behind a public release may be is still to be set.
- Settled points from 0004 still hold: no agent is bundled, Open VSX instead of Microsoft's Marketplace, MIT notices kept, no Microsoft trademarks.

**Revisit** if one upstream merge takes more than a day, or if the editor's own changes keep breaking our edits to the same files.
