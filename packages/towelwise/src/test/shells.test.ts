import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { available, plan, ShellKey, startDir, systemExe } from '../shells';

const SYSTEM = 'C:\\Windows';
const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const CMD = 'C:\\Windows\\System32\\cmd.exe';
const WSL = 'C:\\Windows\\System32\\wsl.exe';
const machine = {
  platform: 'win32',
  systemRoot: SYSTEM,
  pwsh: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
  gitBash: 'C:\\Program Files\\Git\\git-bash.exe',
  wslDistros: ['Ubuntu'],
};
const nothing = { platform: 'win32', systemRoot: SYSTEM, wslDistros: [] as string[] };
const ADMIN: ShellKey[] = ['powershellAdmin', 'cmdAdmin', 'pwshAdmin'];
const ALL: ShellKey[] = ['powershell', 'powershellAdmin', 'cmd', 'cmdAdmin', 'gitbash', 'pwsh', 'pwshAdmin', 'wsl'];

// The fixed text an administrator launcher runs. It never contains a folder or a program path: those arrive in
// environment variables, which PowerShell reads as values and never parses as code.
// The elevated window does not inherit the environment, so the values reach it as lists of character codes.
const CODES_DIR = "$d = ($env:TW_SHELL_DIR.ToCharArray() | ForEach-Object { [int]$_ }) -join ','; ";
const CODES_CMD = "$c = ($env:TW_SHELL_CMD.ToCharArray() | ForEach-Object { [int]$_ }) -join ','; ";
const LAUNCH_SHELL =
  CODES_DIR +
  "Start-Process -FilePath $env:TW_SHELL_PROGRAM -Verb RunAs -ArgumentList '-NoExit','-Command',('Set-Location -LiteralPath ([string]::new([char[]](' + $d + ')))')";
const LAUNCH_CMD =
  CODES_DIR +
  CODES_CMD +
  "Start-Process -FilePath $env:TW_SHELL_PROGRAM -Verb RunAs -ArgumentList '-Command',('Set-Location -LiteralPath ([string]::new([char[]](' + $d + '))); & ([string]::new([char[]](' + $c + '))) /k')";

// Names that must stay data. The curly and low single quotes are string delimiters in PowerShell, as well as the
// plain apostrophe.
const HOSTILE = [
  "C:\\Users\\me\\it's mine",
  'C:\\Users\\me\\review\u2019; Write-Output TOWELWISE_QUOTE_PROBE; #',
  'C:\\Users\\me\\a\u2018b',
  'C:\\Users\\me\\a\u201Ab',
  'C:\\Users\\me\\a\u201Bb',
  'C:\\Users\\me\\a\u201Cb\u201D',
  'C:\\Users\\me\\a;b',
  'C:\\Users\\me\\a&b',
  'C:\\Users\\me\\%PATH%',
  'C:\\Users\\me\\$x and $(calc)',
  'C:\\Users\\me\\with space',
  "C:\\x'; calc; '",
  "C:\\x''y",
  'C:\\Users\\me\\caf\u00e9 \u65e5\u672c',
];

suite('external shells', () => {
  test('plain shells start in the folder, with their own console window', () => {
    const dir = 'C:\\Projects\\my app';
    // The same way VS Code's own "Open New External Terminal" does it: `start` opens a new window, and the
    // folder is the working directory, never part of a command line. Every program is an absolute path.
    const start = (title: string, ...program: string[]) => ({ file: CMD, args: ['/c', 'start', title, ...program], cwd: dir });
    assert.deepStrictEqual(plan('powershell', dir, machine), start('Towelwise PowerShell', PS, '-NoExit'));
    assert.deepStrictEqual(plan('cmd', dir, machine), start('Towelwise Command Prompt', CMD, '/k'));
    assert.deepStrictEqual(plan('pwsh', dir, machine), start('Towelwise PowerShell 7', machine.pwsh, '-NoExit'));
    assert.deepStrictEqual(plan('gitbash', dir, machine), start('Towelwise Git Bash', machine.gitBash));
    assert.deepStrictEqual(plan('wsl', dir, machine), start('Towelwise WSL', WSL));
  });

  test('a shell that is not installed cannot be planned', () => {
    for (const key of ['pwsh', 'pwshAdmin', 'gitbash'] as ShellKey[]) {
      assert.throws(() => plan(key, 'C:\\x', nothing), Error, key);
    }
  });

  test("administrator shells ask Windows' own prompt from fixed text, with the folder and program in the environment", () => {
    const dir = 'C:\\Projects\\app';
    assert.deepStrictEqual(plan('powershellAdmin', dir, machine), {
      file: PS,
      args: ['-NoProfile', '-Command', LAUNCH_SHELL],
      cwd: dir,
      env: { TW_SHELL_PROGRAM: PS, TW_SHELL_DIR: dir },
    });
    assert.deepStrictEqual(plan('pwshAdmin', dir, machine), {
      file: PS,
      args: ['-NoProfile', '-Command', LAUNCH_SHELL],
      cwd: dir,
      env: { TW_SHELL_PROGRAM: machine.pwsh, TW_SHELL_DIR: dir },
    });
    // Command Prompt starts inside an elevated PowerShell that has already changed folder, so the folder never
    // reaches Command Prompt's own parsing, where %NAME% and & would matter.
    assert.deepStrictEqual(plan('cmdAdmin', dir, machine), {
      file: PS,
      args: ['-NoProfile', '-Command', LAUNCH_CMD],
      cwd: dir,
      env: { TW_SHELL_PROGRAM: PS, TW_SHELL_DIR: dir, TW_SHELL_CMD: CMD },
    });
  });

  test('a folder name is only ever data: the command line does not depend on it at all', () => {
    for (const key of ADMIN) {
      const baseline = plan(key, 'C:\\Projects\\app', machine);
      for (const dir of HOSTILE) {
        const p = plan(key, dir, machine);
        assert.deepStrictEqual(p.args, baseline.args, `${key} ${dir}: the command line must not change with the folder`);
        assert.strictEqual(p.env?.TW_SHELL_DIR, dir, `${key} ${dir}: the folder arrives exactly, as an environment value`);
        assert.ok(!p.args.some((a) => a.includes(dir)), `${key} ${dir}`);
      }
    }
  });

  test('no plan uses an encoded command, which Windows Defender treats as malware-like', () => {
    // A launcher with -EncodedCommand was blocked as "CMD_HSTR:General.ML.B" before any permission prompt could show.
    for (const dir of ['C:\\Projects\\app', ...HOSTILE]) {
      for (const key of ALL) {
        for (const arg of plan(key, dir, machine).args) {
          assert.ok(!/^-e(nc|ncodedcommand|ncodedc\w*)?$/i.test(arg), `${key}: ${arg}`);
          assert.ok(!/[A-Za-z0-9+/]{60,}={0,2}/.test(arg), `${key}: looks like a base64 payload`);
        }
      }
    }
  });

  test('no program is looked up by name: a project folder cannot supply its own powershell.exe or cmd.exe', () => {
    // A bare name is searched for in the current folder first on Windows, so every program is a full path.
    const isFull = (p: string) => path.win32.isAbsolute(p) && /\.exe$/i.test(p);
    for (const dir of ['C:\\Projects\\app', ...HOSTILE]) {
      for (const key of ALL) {
        const p = plan(key, dir, machine);
        assert.ok(isFull(p.file), `${key} launcher ${p.file}`);
        if (p.args[0] === '/c') assert.ok(isFull(p.args[3]), `${key} program ${p.args[3]}`);
        for (const name of ['TW_SHELL_PROGRAM', 'TW_SHELL_CMD']) {
          if (p.env?.[name] !== undefined) assert.ok(isFull(p.env[name]), `${key} ${name} ${p.env[name]}`);
        }
      }
    }
  });

  test('system programs come from the Windows folder, wherever it is', () => {
    assert.strictEqual(systemExe('D:\\WIN', 'cmd.exe'), 'D:\\WIN\\System32\\cmd.exe');
    assert.strictEqual(systemExe('D:\\WIN', 'wsl.exe'), 'D:\\WIN\\System32\\wsl.exe');
    assert.strictEqual(systemExe('D:\\WIN', 'powershell.exe'), 'D:\\WIN\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.strictEqual(plan('powershell', 'C:\\x', { ...machine, systemRoot: 'D:\\WIN' }).file, 'D:\\WIN\\System32\\cmd.exe');
  });

  // The real PowerShell, on Windows only.
  (process.platform === 'win32' ? test : test.skip)('PowerShell parses the fixed scripts as only the commands we wrote', function () {
    this.timeout(60000);
    // What the elevated window runs, with sample codes in place of the real ones.
    const inner = ['Set-Location -LiteralPath ([string]::new([char[]](67,58,92)))', 'Set-Location -LiteralPath ([string]::new([char[]](67,58,92))); & ([string]::new([char[]](67,58))) /k'];
    const scripts = [LAUNCH_SHELL, LAUNCH_CMD, ...inner];
    const probe =
      '$list=Get-Content -Raw -Encoding UTF8 $env:TW_SCRIPTS | ConvertFrom-Json;' +
      'foreach($x in $list){$e=$null;$t=$null;$a=[System.Management.Automation.Language.Parser]::ParseInput($x,[ref]$t,[ref]$e);' +
      '$c=$a.FindAll({param($n) $n -is [System.Management.Automation.Language.CommandAst]},$true).Count;' +
      '"$($e.Count) $($a.EndBlock.Statements.Count) $c"}';
    const file = path.join(os.tmpdir(), `tw-scripts-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(file, JSON.stringify(scripts), 'utf8');
    try {
      const out = execFileSync(PS, ['-NoProfile', '-NonInteractive', '-Command', probe], { env: { ...process.env, TW_SCRIPTS: file }, encoding: 'utf8' }).trim().split(/\r?\n/);
      // Each result reads: parse errors, statements, commands. The launchers: the code lists (ForEach-Object) and
      // Start-Process, nothing else. The elevated scripts: Set-Location, then for Command Prompt the one call.
      assert.deepStrictEqual(out, ['0 2 2', '0 3 3', '0 1 1', '0 2 2']);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  // PowerShell reads a value from the environment exactly, whatever it contains: the property the whole design rests on.
  (process.platform === 'win32' ? test : test.skip)('PowerShell reads every hostile folder name back exactly from the environment', function () {
    this.timeout(120000);
    for (const dir of HOSTILE) {
      const p = plan('powershellAdmin', dir, machine);
      const read = execFileSync(
        PS,
        ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Output $env:TW_SHELL_DIR'],
        { env: { ...process.env, ...p.env }, encoding: 'utf8' },
      ).replace(/\r?\n$/, '');
      assert.strictEqual(read, dir);
    }
  });

  // The real launcher text, with only the permission prompt taken out: Start-Process becomes a plain assignment, and
  // the elevated text it would have sent is run here with Set-Location turned into Write-Output.
  (process.platform === 'win32' ? test : test.skip)('the text sent to the elevated window rebuilds every hostile folder and program exactly', function () {
    this.timeout(120000);
    for (const key of ['powershellAdmin', 'cmdAdmin'] as ShellKey[]) {
      for (const dir of HOSTILE) {
        const p = plan(key, dir, machine);
        const cut = p.args[2].indexOf('Start-Process');
        const elevatedExpression = p.args[2].slice(p.args[2].indexOf("('Set-Location"));
        const script =
          p.args[2].slice(0, cut) +
          `$r = ${elevatedExpression}; $r = $r.Replace('Set-Location -LiteralPath ', 'Write-Output ').Replace(' /k', ' /c echo DONE'); Invoke-Expression $r`;
        const out = execFileSync(PS, ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ' + script], {
          env: { ...process.env, ...p.env },
          encoding: 'utf8',
        }).replace(/\r?\n$/, '').split(/\r?\n/);
        assert.deepStrictEqual(out, key === 'cmdAdmin' ? [dir, 'DONE'] : [dir], `${key} ${dir}`);
      }
    }
  });

  test('plain shells never put the folder on a command line', () => {
    for (const dir of HOSTILE) {
      for (const key of ['powershell', 'cmd', 'pwsh', 'gitbash', 'wsl'] as ShellKey[]) {
        const p = plan(key, dir, machine);
        assert.strictEqual(p.cwd, dir, key);
        assert.ok(!p.args.some((a) => a.includes(dir)), `${key} ${dir}`);
      }
    }
  });

  test('the starting folder is the first workspace folder, else home', () => {
    assert.strictEqual(startDir(['C:\\a', 'C:\\b'], 'C:\\Users\\me'), 'C:\\a');
    assert.strictEqual(startDir([], 'C:\\Users\\me'), 'C:\\Users\\me');
  });

  test('only installed shells are available, and WSL needs a distribution', () => {
    assert.deepStrictEqual(available(nothing), ['powershell', 'powershellAdmin', 'cmd', 'cmdAdmin']);
    assert.deepStrictEqual(available(machine), ['powershell', 'powershellAdmin', 'cmd', 'cmdAdmin', 'gitbash', 'pwsh', 'pwshAdmin', 'wsl']);
    assert.deepStrictEqual(available({ ...nothing, gitBash: machine.gitBash }), ['powershell', 'powershellAdmin', 'cmd', 'cmdAdmin', 'gitbash']);
    assert.ok(!available({ ...nothing, wslDistros: [] }).includes('wsl'), 'WSL with no distribution must stay hidden');
    assert.deepStrictEqual(available({ platform: 'linux', systemRoot: '', wslDistros: [] }), []);
    assert.deepStrictEqual(available({ platform: 'darwin', systemRoot: '', pwsh: 'x', gitBash: 'y', wslDistros: ['Ubuntu'] }), []);
  });

  test('every shell command is in the manifest with a title, no shortcut, and a palette entry gated on availability', () => {
    const contributes = vscode.extensions.getExtension('towelwise.towelwise')?.packageJSON.contributes;
    const titles: Record<string, string> = {
      powershell: 'Towelwise: Open PowerShell',
      powershellAdmin: 'Towelwise: Open PowerShell (Admin)',
      cmd: 'Towelwise: Open Command Prompt',
      cmdAdmin: 'Towelwise: Open Command Prompt (Admin)',
      gitbash: 'Towelwise: Open Git Bash',
      pwsh: 'Towelwise: Open PowerShell 7',
      pwshAdmin: 'Towelwise: Open PowerShell 7 (Admin)',
      wsl: 'Towelwise: Open WSL',
    };
    for (const [key, title] of Object.entries(titles)) {
      const id = `towelwise.shell.${key}`;
      assert.strictEqual(contributes.commands.find((c: { command: string }) => c.command === id)?.title, title, id);
      assert.ok(!contributes.keybindings.some((k: { command: string }) => k.command === id), `${id} has a shortcut`);
      const entry = contributes.menus.commandPalette.find((m: { command: string }) => m.command === id);
      assert.strictEqual(entry?.when, `towelwise.shell.available.${key}`, id);
    }
  });

  test('the shell commands are registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const key of ALL) {
      assert.ok(commands.includes(`towelwise.shell.${key}`), key);
    }
  });
});
