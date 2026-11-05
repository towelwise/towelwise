# Towelwise AI

**Your IDE, built for hyperspace.** *Don't Panic.*

Towelwise AI is a free, open-source IDE for working with AI coding agents. It is built from [Code-OSS](https://github.com/microsoft/vscode), the open-source core of VS Code, and it works alongside the agents you already use without ever driving them.

It is built around three things you shape yourself:

- **Hyperspace:** a focus mode laid out exactly your way.
- **Recall:** a memory of what you approved, contained to the IDE.
- **Learning:** lessons drawn from your own work.

Website: [towelwise.github.io](https://towelwise.github.io)

## Status

**Early, and not released yet.** There is no installer and no download. Today the app is built from source, on Windows only, and so far only on its maker's machine. Hyperspace works. Recall and Learning are planned. [ROADMAP.md](ROADMAP.md) has the order things get built in and what "done" means for each step.

What works today:

- **Its own app.** Its own name, icon and data folder, side by side with VS Code. Extensions come from Open VSX, and telemetry is off.
- **Agents.** Claude Code and Codex install, sign in and work in it. Nothing is bundled: you install an agent and sign in yourself.
- **Jump to hyperspace.** One key hides the parts of the window you chose, and the same key puts your settings back. **Edit Hyperspace Layout** is a clickable mock window for choosing what to keep or hide.
- **My layout.** **Choose Layout** is a page where you pick your agents, place each in a side bar, the bottom panel or an editor column, set sizes, and add terminals. **Restore Layout** brings it all back, in any project.
- **A Towelwise menu**, and a setting that hides any built-in menu entry you do not want.
- **Shells outside the IDE.** PowerShell, Command Prompt and Git Bash (plus PowerShell 7 and WSL where installed), each starting in your project folder. Administrator entries use Windows' own permission prompt.

Still ahead for the layout editor: applying your layout when a window opens, and locking hyperspace so nothing else opens while it is on.

## Try it: build from source

You need Windows, Git Bash, and these on your path: `git`, `node` (22 or newer), `npm`, `jq`, `python`, `7z` and `cargo`. From Git Bash, in the repo root:

```sh
bash ide/build.sh
```

The script builds the extension, takes VSCodium's build scripts at the version pinned in [ide/upstream.env](ide/upstream.env), applies our patches, and builds the app. A full build took about 14 minutes on the maker's machine. It works in `C:\tw-build` (set `TW_BUILD_DIR` to change that) and writes a portable zip to `dist\TowelwiseAI-win32-x64-<version>.zip` inside it. Unzip it anywhere and run the app.

## Develop the extension

Most of what Towelwise adds lives in a built-in extension, [packages/towelwise/](packages/towelwise/). Core code is patched only where an extension cannot reach ([decision 0005](docs/decisions/0005-patch-core-only-when-the-extension-cannot.md)); those patches are in [ide/patches/](ide/patches/). From the repo root, with Node 22+ and npm:

```sh
npm ci
npm run lint
npm run build
npm test          # downloads VS Code on first run and opens a window
npm run package   # writes packages/towelwise/towelwise.vsix
```

The extension is tested on the latest VS Code and on 1.90.0, the oldest version it claims to support.

## Where things are

| Path | What it holds |
|---|---|
| [packages/towelwise/](packages/towelwise/) | The built-in extension: hyperspace, layout, shells, the Towelwise menu |
| [ide/](ide/) | The build script, the pinned upstream version, our core patches and the app's icons |
| [docs/decisions/](docs/decisions/) | Short records of the big choices: what was chosen, why, what was ruled out |
| [.work/specs/](.work/specs/) | The spec for each piece of work |
| [ROADMAP.md](ROADMAP.md) | The plan, phase by phase |
| [GLOSSARY.md](GLOSSARY.md) | What the project's words mean |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security problem, see [SECURITY.md](SECURITY.md).

## License and credits

Apache 2.0, see [LICENSE](LICENSE). The names Towelwise, Towelwise AI, Towelwise Recall, Towelwise Guide and DOUG are not covered by that license; see [NOTICE](NOTICE).

Towelwise AI is built from Code-OSS (MIT), starting from the build scripts of [VSCodium](https://github.com/VSCodium/vscodium) (MIT). Towelwise Recall is planned to be built on [Hindsight](https://github.com/vectorize-io/hindsight) (MIT) by Vectorize. Towelwise AI is not affiliated with or endorsed by the estate of Douglas Adams, Anthropic, OpenAI, Google, Microsoft or Vectorize; the names are an affectionate nod to Douglas Adams's books.

*Towelwise AI: mostly helpful.*
