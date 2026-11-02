import { execFile, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Shells opened in a normal window outside the IDE. The integrated terminal is not touched.
export type ShellKey = 'powershell' | 'powershellAdmin' | 'cmd' | 'cmdAdmin' | 'gitbash' | 'pwsh' | 'pwshAdmin' | 'wsl';

export const SHELL_KEYS: readonly ShellKey[] = ['powershell', 'powershellAdmin', 'cmd', 'cmdAdmin', 'gitbash', 'pwsh', 'pwshAdmin', 'wsl'];

export interface Machine {
  platform: string;
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

// A single-quoted PowerShell literal: only the quote itself needs doubling, so nothing inside can run.
const literal = (text: string) => `'${text.replace(/'/g, "''")}'`;
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
  const start = (title: string, ...program: string[]): Plan => ({ file: 'cmd.exe', args: ['/c', 'start', title, ...program], cwd: dir });
  const elevate = (program: string, shellArgs: string[], innerScript: string): Plan => {
    const inner = encode(innerScript);
    const list = [...shellArgs, '-EncodedCommand', inner].map(literal).join(',');
    const launcher = encode(`Start-Process -FilePath ${literal(program)} -Verb RunAs -ArgumentList @(${list})`);
    return { file: 'powershell.exe', args: ['-NoProfile', '-EncodedCommand', launcher], cwd: dir };
  };
  const go = `Set-Location -LiteralPath ${literal(dir)}`;

  switch (key) {
    case 'powershell':
      return start(TITLES.powershell, 'powershell.exe', '-NoExit');
    case 'cmd':
      return start(TITLES.cmd, 'cmd.exe', '/k');
    case 'pwsh':
      return start(TITLES.pwsh, need(machine.pwsh, 'PowerShell 7'), '-NoExit');
    case 'gitbash':
      return start(TITLES.gitbash, need(machine.gitBash, 'Git Bash'));
    case 'wsl':
      return start(TITLES.wsl, 'wsl.exe');
    case 'powershellAdmin':
      return elevate('powershell.exe', ['-NoExit'], go);
    case 'pwshAdmin':
      return elevate(need(machine.pwsh, 'PowerShell 7'), ['-NoExit'], go);
    case 'cmdAdmin':
      // Command Prompt starts inside an elevated PowerShell that has already changed folder, so the folder
      // never reaches Command Prompt's own parsing, where %NAME% and & would matter.
      return elevate('powershell.exe', [], `${go}; & cmd.exe /k`);
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
function wslDistros(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile('wsl.exe', ['-l', '-q'], { encoding: 'buffer', windowsHide: true, timeout: 5000 }, (error, stdout) => {
      if (error) return resolve([]);
      const text = Buffer.from(stdout).toString('utf16le').replace(/\0/g, '').replace(/^\uFEFF/, '');
      resolve(text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
    });
  });
}

export async function detectMachine(): Promise<Machine> {
  if (process.platform !== 'win32') return { platform: process.platform, wslDistros: [] };
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const local = process.env.LOCALAPPDATA;
  return {
    platform: process.platform,
    pwsh: firstExisting([path.join(programFiles, 'PowerShell', '7', 'pwsh.exe'), local && path.join(local, 'Microsoft', 'WindowsApps', 'pwsh.exe')]),
    gitBash: firstExisting([
      path.join(programFiles, 'Git', 'git-bash.exe'),
      programFilesX86 && path.join(programFilesX86, 'Git', 'git-bash.exe'),
      local && path.join(local, 'Programs', 'Git', 'git-bash.exe'),
    ]),
    wslDistros: await wslDistros(),
  };
}
