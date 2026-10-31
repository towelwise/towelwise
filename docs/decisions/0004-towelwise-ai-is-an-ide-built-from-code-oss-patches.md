# Towelwise AI is an IDE built from Code-OSS with a small patch set

Towelwise began as a VS Code extension, and that showed its limit: extensions cannot read or set the layout ([0003](0003-hyperspace-never-reads-or-reopens-layout-state.md)), so the product's main idea, a window laid out exactly as a person chooses and held that way, could not be built as one. Towelwise AI is now its own IDE: scripts that take upstream Code-OSS and apply a small set of patches, in the way VSCodium does and starting from its MIT-licensed scripts. Most Towelwise code stays in a built-in extension, and core patches are kept few and careful so each upstream release is cheap to absorb.

A one-evening test on VSCodium (2026-10-31, Windows) showed that Claude Code and Codex install from Open VSX, sign in fresh with separate config folders, chat, and survive a reload. That test was the condition for this decision. VSCodium is a stand-in, so the sign-in test is repeated on the first Towelwise AI build.

**Ruled out:**

- **Staying an extension.** Simple and reaches VS Code users, but the layout vision and contained memory cannot exist there. The extension is not released; its code becomes the built-in extension.
- **A full fork of `microsoft/vscode`.** The most freedom, but changes spread through the source and upstream merges by hand, which at about 5 to 10 hours a week could consume the project.
- **Eclipse Theia.** A framework designed for building custom IDEs, with lighter upkeep expected and its own Claude Code integration. Set aside because the owner wants the VS Code base, and running the vendors' own extensions unchanged is the tested path. Webview and proposed-API support on Theia were not verified.

**Consequences:**

- No agent is bundled. People install agents from Open VSX and sign in themselves, because Anthropic's terms require its Commercial Terms for preinstalling and forbid third parties from offering Claude login. The product says "works with", never "official" or "supported by".
- Microsoft's Marketplace is not available, since its terms limit it to Microsoft's products. Extensions not on Open VSX, currently including Copilot, are not offered.
- Upkeep is now part of the product: each Code-OSS release, with its security fixes, must be re-based. The real cost is unknown until the first build has been through an upstream release, which the first milestone measures. If it is not sustainable, revisit this decision.
- Recall, Guide and DOUG ship inside the IDE instead of as separate extensions, so memory stays contained to it.
- Recall will use a fork of Hindsight (MIT), shaped to recall the way we want and made an official component. That adds a second upstream to keep current.

**Revisit** if upkeep exceeds what the project can sustain, or if vendors change how their extensions may be used on non-Microsoft builds.
