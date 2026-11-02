import { execFile, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Shells opened in a normal window outside the IDE. The integrated terminal is not touched.
export type ShellKey = 'powershell' | 'powershellAdmin' | 'cmd' | 'cmdAdmin' | 'gitbash' | 'pwsh' | 'pwshAdmin' | 'wsl';

export const SHELL_KEYS: readonly ShellKey[] = ['powershell', 'powershellAdmin', 'cmd', 'cmdAdmin', 'gitbash', 'pwsh', 'pwshAdmin', 'wsl'];

export interface Machine {
  platform: string;
  // The Windows folder, from the environment. System programs are run from here by full path.
  systemRoot: string;
  pwsh?: string;
  gitBash?: string;
  wslDistros: string[];
}

export interface Plan {
  file: string;
  args: string[];
  cwd: string;
}

const TITLES: Record<string, string> = {
  powershell: 'Towelwise PowerShell',
  cmd: 'Towelwise Command Prompt',
  pwsh: 'Towelwise PowerShell 7',
  gitbash: 'Towelwise Git Bash',
  wsl: 'Towelwise WSL',
};

// System programs by full path. A bare name such as powershell.exe is searched for in the current folder
// first on Windows, so a project could ship its own and have it run instead.
export function systemExe(root: string, name: 'cmd.exe' | 'powershell.exe' | 'wsl.exe'): string {
  const windows = path.win32;
  return name === 'powershell.exe'
    ? windows.join(root, 'System32', 'WindowsPowerShell', 'v1.0', name)
    : windows.join(root, 'System32', name);
}

// Text that comes from outside (a folder name, a program path) is never written into a script as text:
// PowerShell reads several characters as quotes (the plain apostrophe and the curly and low single quotes),
// and a name containing one could end the string and add commands. It goes in as base64, whose alphabet
// holds nothing PowerShell treats as syntax, and the script decodes it.
const data = (text: string) =>
  `([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${Buffer.from(text, 'utf8').toString('base64')}')))`;
// Fixed ASCII tokens only (flags and base64): safe to quote plainly.
const token = (text: string) => `'${text}'`;
const encode = (script: string) => Buffer.from(script, 'utf16le').toString('base64');

export const startDir = (folders: string[], home: string): string => folders[0] ?? home;

export function available(machine: Machine): ShellKey[] {
  if (machine.platform !== 'win32') return [];
  const keys: ShellKey[] = ['powershell', 'powershellAdmin', 'cmd', 'cmdAdmin'];
  if (machine.gitBash) keys.push('gitbash');
  if (machine.pwsh) keys.push('pwsh', 'pwshAdmin');
  if (machine.wslDistros.length > 0) keys.push('wsl');
  return keys;
}

// How to start a shell. Plain shells use `start`, as VS Code's own external terminal does, with the folder
// as the working directory. Administrator shells run Start-Process -Verb RunAs from an encoded script, so the
// folder only ever appears inside one quoted literal, and Windows shows its own permission prompt.
export function plan(key: ShellKey, dir: string, machine: Machine): Plan {
  const need = (value: string | undefined, what: string) => {
    if (!value) throw new Error(`${what} is not installed`);
    return value;
  };
  const cmdExe = systemExe(machine.systemRoot, 'cmd.exe');
  const psExe = systemExe(machine.systemRoot, 'powershell.exe');
  const start = (title: string, ...program: string[]): Plan => ({ file: cmdExe, args: ['/c', 'start', title, ...program], cwd: dir });
  const elevate = (program: string, shellArgs: string[], innerScript: string): Plan => {
    const list = [...shellArgs, '-EncodedCommand', encode(innerScript)].map(token).join(',');
    const launcher = encode(`Start-Process -FilePath ${data(program)} -Verb RunAs -ArgumentList @(${list})`);
    return { file: psExe, args: ['-NoProfile', '-EncodedCommand', launcher], cwd: dir };
  };
  const go = `Set-Location -LiteralPath ${data(dir)}`;

  switch (key) {
    case 'powershell':
      return start(TITLES.powershell, psExe, '-NoExit');
    case 'cmd':
      return start(TITLES.cmd, cmdExe, '/k');
    case 'pwsh':
      return start(TITLES.pwsh, need(machine.pwsh, 'PowerShell 7'), '-NoExit');
    case 'gitbash':
      return start(TITLES.gitbash, need(machine.gitBash, 'Git Bash'));
    case 'wsl':
      return start(TITLES.wsl, systemExe(machine.systemRoot, 'wsl.exe'));
    case 'powershellAdmin':
      return elevate(psExe, ['-NoExit'], go);
    case 'pwshAdmin':
      return elevate(need(machine.pwsh, 'PowerShell 7'), ['-NoExit'], go);
    case 'cmdAdmin':
      // Command Prompt starts inside an elevated PowerShell that has already changed folder, so the folder
      // never reaches Command Prompt's own parsing, where %NAME% and & would matter.
      return elevate(psExe, [], `${go}; & ${data(cmdExe)} /k`);
  }
}

// 'opened' once the window was started; for administrator shells, 'cancelled' if the permission prompt was declined.
export function launch(key: ShellKey, dir: string, machine: Machine): Promise<'opened' | 'cancelled'> {
  const p = plan(key, dir, machine);
  const elevated = key.endsWith('Admin');
  return new Promise((resolve, reject) => {
    const child = spawn(p.file, p.args, { cwd: p.cwd, detached: !elevated, windowsHide: elevated, stdio: 'ignore' });
    child.once('error', reject);
    if (elevated) {
      child.once('exit', (code) => resolve(code === 0 ? 'opened' : 'cancelled'));
    } else {
      child.once('spawn', () => {
        child.unref();
        resolve('opened');
      });
    }
  });
}

const firstExisting = (candidates: Array<string | undefined>): string | undefined =>
  candidates.find((p): p is string => p !== undefined && fs.existsSync(p));

// `wsl -l -q` prints one installed distribution per line in UTF-16, and nothing when there is none.
function wslDistros(systemRoot: string): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(systemExe(systemRoot, 'wsl.exe'), ['-l', '-q'], { encoding: 'buffer', windowsHide: true, timeout: 5000 }, (error, stdout) => {
      if (error) return resolve([]);
      const text = Buffer.from(stdout).toString('utf16le').replace(/\0/g, '').replace(/^\uFEFF/, '');
      resolve(text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
    });
  });
}

export async function detectMachine(): Promise<Machine> {
  if (process.platform !== 'win32') return { platform: process.platform, systemRoot: '', wslDistros: [] };
  const systemRoot = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows';
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const local = process.env.LOCALAPPDATA;
  return {
    platform: process.platform,
    systemRoot,
    pwsh: firstExisting([path.join(programFiles, 'PowerShell', '7', 'pwsh.exe'), local && path.join(local, 'Microsoft', 'WindowsApps', 'pwsh.exe')]),
    gitBash: firstExisting([
      path.join(programFiles, 'Git', 'git-bash.exe'),
      programFilesX86 && path.join(programFilesX86, 'Git', 'git-bash.exe'),
      local && path.join(local, 'Programs', 'Git', 'git-bash.exe'),
    ]),
    wslDistros: await wslDistros(systemRoot),
  };
}
