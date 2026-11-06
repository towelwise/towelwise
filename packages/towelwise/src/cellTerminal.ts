// Which terminal a terminal cell opens: the shell, its name, the folder it starts in, and a command to run once it
// opens. Pure logic; the shells are the ones shells.ts finds on this machine, opened in the editor area instead of a
// window of their own.
import * as path from 'node:path';
import { Machine, available, systemExe } from './shells';

export const TERMINAL_SHELLS = ['default', 'powershell', 'pwsh', 'cmd', 'gitbash', 'wsl'] as const;
export type TerminalShell = (typeof TERMINAL_SHELLS)[number];

/** What a cell's terminal is. An empty field is left out; no shell means the person's default profile. */
export interface CellTerminal {
  shell?: Exclude<TerminalShell, 'default'>;
  name?: string;
  folder?: string;
  command?: string;
}

export const SHELL_LABELS: Record<TerminalShell, string> = {
  default: 'Terminal',
  powershell: 'PowerShell',
  pwsh: 'PowerShell 7',
  cmd: 'Command Prompt',
  gitbash: 'Git Bash',
  wsl: 'WSL',
};

const TEXT_FIELDS = ['name', 'folder', 'command'] as const;

/**
 * A cell's terminal from the saved setting or the page, with empty fields dropped; undefined if it does not fit (not
 * an object, an unknown shell, or a field that is not text).
 */
export function parseCellTerminal(raw: unknown): CellTerminal | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: CellTerminal = {};
  if (r.shell !== undefined) {
    if (!(TERMINAL_SHELLS as readonly unknown[]).includes(r.shell)) return undefined;
    if (r.shell !== 'default') out.shell = r.shell as CellTerminal['shell'];
  }
  for (const field of TEXT_FIELDS) {
    const value = r[field];
    if (value === undefined) continue;
    if (typeof value !== 'string') return undefined;
    if (value.trim() !== '') out[field] = value.trim();
  }
  return out;
}

export const isEmptyTerminal = (t: CellTerminal | undefined): boolean => !t || Object.keys(t).length === 0;

/** The name the terminal opens with, and is found by: the one given, or its shell's. */
export const terminalName = (t: CellTerminal): string => t.name ?? SHELL_LABELS[t.shell ?? 'default'];

/** Default first, then the shells this machine has. Administrator shells are left out: each open would ask permission. */
export function shellsOn(machine: Machine): TerminalShell[] {
  const found = available(machine).filter((k) => (TERMINAL_SHELLS as readonly string[]).includes(k)) as TerminalShell[];
  return ['default', ...found];
}

/** The program a shell runs in the integrated terminal; undefined if this machine does not have it. */
export function launchOf(shell: TerminalShell, machine: Machine): { shellPath?: string; shellArgs?: string[] } | undefined {
  if (shell === 'default') return {};
  if (!shellsOn(machine).includes(shell)) return undefined;
  switch (shell) {
    case 'powershell':
      return { shellPath: systemExe(machine.systemRoot, 'powershell.exe') };
    case 'cmd':
      return { shellPath: systemExe(machine.systemRoot, 'cmd.exe') };
    case 'wsl':
      return { shellPath: systemExe(machine.systemRoot, 'wsl.exe') };
    case 'pwsh':
      return machine.pwsh ? { shellPath: machine.pwsh } : undefined;
    case 'gitbash':
      // Found by git-bash.exe, which opens a window of its own; the shell for a terminal is bin\bash.exe beside it.
      return machine.gitBash
        ? { shellPath: path.win32.join(path.win32.dirname(machine.gitBash), 'bin', 'bash.exe'), shellArgs: ['--login', '-i'] }
        : undefined;
  }
}

/** Everything createTerminal needs, and the command to send once it is open. */
export interface TerminalOpen {
  name: string;
  shellPath?: string;
  shellArgs?: string[];
  cwd?: string;
  command?: string;
}

/**
 * How to open a cell's terminal on this machine. A shell this machine does not have opens as the default one, and a
 * folder that does not exist opens in the workspace folder; each is a problem line for the restore report.
 */
export function planTerminal(
  t: CellTerminal,
  machine: Machine,
  folders: readonly string[],
  exists: (p: string) => boolean,
  trusted = true,
): { open: TerminalOpen; problems: string[] } {
  const name = terminalName(t);
  const problems: string[] = [];
  const open: TerminalOpen = { name };
  const shell = t.shell ?? 'default';
  const launch = launchOf(shell, machine);
  if (launch) Object.assign(open, launch);
  else problems.push(`${name}: ${SHELL_LABELS[shell]} was not found on this machine, so it opened in the default shell`);
  // Always the first workspace folder unless a folder that exists is chosen: left unset, VS Code starts the terminal in
  // the last active root of a multi-root workspace, and the startup command would run in a different project.
  if (folders[0] !== undefined) open.cwd = folders[0];
  if (t.folder) {
    const where = path.isAbsolute(t.folder) ? t.folder : folders[0] !== undefined ? path.join(folders[0], t.folder) : undefined;
    if (where !== undefined && exists(where)) open.cwd = where;
    else problems.push(`${name}: the folder "${t.folder}" was not found, so it opened in the workspace folder`);
  }
  // A startup command runs the project's own scripts, so only in a project the person trusts (decision 0006).
  if (t.command && trusted) open.command = t.command;
  else if (t.command) problems.push(`${name}: its startup command did not run, because this project is not trusted. Trust it and reload the window to run it`);
  return { open, problems };
}
