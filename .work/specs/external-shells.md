# External shells: open PowerShell, Command Prompt and others outside the IDE

Status: ready-for-agent

## Goal

The no-patch first step of the terminal decision in [ROADMAP.md](../../ROADMAP.md) ("Strip-down candidates", terminal, decided 2026-11-02) and of [decision 0005](../../docs/decisions/0005-patch-core-only-when-the-extension-cannot.md): commands in the built-in extension that open a shell in a normal window outside the IDE, including administrator versions. Hiding the integrated terminal's entry points and placing these in the top Terminal menu need a core patch and are a later slice. Windows first.

## Acceptance criteria

1. Command Palette commands from the built-in extension, with no default keybindings: **Towelwise: Open PowerShell**, **Open PowerShell (Admin)**, **Open Command Prompt**, **Open Command Prompt (Admin)**, **Open Git Bash**, **Open PowerShell 7**, **Open PowerShell 7 (Admin)** and **Open WSL**.
2. Each opens a shell in a normal window outside the IDE, starting in the first workspace folder, or the user's home folder when no folder is open.
3. A command shows in the palette only when its shell is installed. PowerShell and Command Prompt are always shown on Windows. PowerShell 7 needs `pwsh.exe`. Git Bash needs Git for Windows' launcher. WSL needs at least one installed Linux distribution (WSL alone is not enough).
4. Administrator commands use Windows' own permission prompt. No elevated shell runs inside the IDE. If the person declines the prompt, the IDE says the launch was cancelled and nothing else happens.
5. Folder names containing spaces, quotes (plain apostrophes and the curly and low single quotes PowerShell also reads as quotes, and double quotes), `&`, `%`, `$`, `;`, `#`, backticks or non-English characters never run as commands: they are only ever the folder the shell starts in. This holds for administrator commands too. No program is started by bare name: system programs run from the Windows folder by full path, so a project folder cannot supply its own `powershell.exe`, `cmd.exe` or `wsl.exe` and have it run (found in review, 2026-11-02, with the curly-quote case).
6. On a system that is not Windows, the commands do nothing harmful: they say they are Windows-only.
7. The integrated terminal and the agents' optional terminal mode are untouched.
8. Root `npm run lint`, `npm run build`, `npm test` and `npm run package` exit 0, and CI passes on the PR.

## Approved decisions (owner, 2026-11-02)

- Keep the integrated terminal; open these shells externally. PowerShell and Command Prompt each with an Admin version; add Git Bash; add PowerShell 7 and WSL only when installed.
- Extension first, no patch for this step ([0005](../../docs/decisions/0005-patch-core-only-when-the-extension-cannot.md)).

## Verification

- **Automated (the extension's tests, no real windows opened):**
  - A pure plan for each shell and for each administrator version, checked as exact process, arguments and starting folder.
  - Administrator plans are a launcher PowerShell with an encoded script; decoding it gives exactly the expected script, and the starting folder inside it round-trips for hostile names (`it's`, curly quotes such as `review’; Write-Output PROBE; #`, `a;b`, `a&b`, `%PATH%`, `$x`, spaces, double quotes, accented and non-Latin letters). Every script is plain ASCII, with folder text only as base64.
  - On Windows, PowerShell's own parser reads every generated script and finds only the commands we wrote (no parse errors, no extra statements), for every hostile name. This is the check that matters; a regular-expression check of the quoting missed the curly quotes.
  - No program is started by bare name: each launcher and each target is an absolute path under the Windows folder (or an explicit installed path for Git Bash and PowerShell 7), for every shell and every hostile name.
  - The choice of starting folder: first workspace folder, else home.
  - Which shells are available, from a fake description of the machine (nothing installed, only built-ins, everything, a WSL with no distribution).
  - The manifest: each command exists with its title, none has a keybinding, and each has a palette entry gated on its availability.
- **Build and package:** the four root commands.
- **Manual (the owner, Windows):** each command opens the right shell in the project folder; the Admin ones show the Windows prompt and open an elevated window there; declining the prompt shows the cancelled message; a project folder with an apostrophe or spaces works; shells you do not have are absent from the palette.

## Implementer defaults (not approved; flag in review)

- Command ids `towelwise.shell.<name>` and the titles in criterion 1.
- Non-administrator shells start by launching the program with the working folder set, detached so it has its own console window. Administrator shells run `Start-Process -Verb RunAs` from an encoded PowerShell script. The folder and the program path are never written into a script as text: they go in as base64 and the script decodes them, so nothing in a name can be read as PowerShell syntax. Elevated Command Prompt is started from an elevated PowerShell that changes folder first, so no folder name ever reaches Command Prompt's own parsing. Every system program is run by full path under the Windows folder.
- Palette gating through `setContext` keys set once at startup, after detecting what is installed.
- Windows Terminal is not included; whether it is an entry or the place the entries open is open.

## Out of scope

- Hiding the integrated terminal's menu items, panel tab and shortcut, and placing these in the top Terminal menu (a later patch, via the hook idea in 0005).
- A user-editable list of shells, an Admin Git Bash, an Admin WSL, macOS and Linux shells.
- Changing the integrated terminal in any way.

## Unresolved / external prerequisites

- Whether Git Bash's launcher starts in the folder from the working directory alone, and whether Windows keeps the starting folder for an elevated window: both need the manual check. The plan sets the folder inside the elevated script so it does not depend on the second.
- Windows Terminal as an entry or as a host.
