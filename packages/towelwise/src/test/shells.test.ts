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

const utf16 = (b64: string) => Buffer.from(b64, 'base64').toString('utf16le');
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
// The launcher PowerShell runs, then the script it hands to the elevated shell.
function scripts(args: string[]) {
  const launcher = utf16(after(args, '-EncodedCommand'));
  const inner = /'-EncodedCommand','([A-Za-z0-9+/=]+)'/.exec(launcher)?.[1];
  return { launcher, inner: inner === undefined ? undefined : utf16(inner) };
}
// Every piece of text a script takes from outside (a folder, a program) is a base64 expression, so it is
// never parsed as PowerShell. This reads those pieces back.
function payloads(script: string): string[] {
  return [...script.matchAll(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/g)].map((m) => Buffer.from(m[1], 'base64').toString('utf8'));
}

// Names that must stay data. The curly and low/high-reversed single quotes are all string delimiters in
// PowerShell, as well as the plain apostrophe.
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

  test('no program is looked up by name: a project folder cannot supply its own powershell.exe or cmd.exe', () => {
    // A bare name is searched for in the current folder first on Windows, so every program is a full path.
    const isFull = (p: string) => path.win32.isAbsolute(p) && /\.exe$/i.test(p);
    for (const dir of ['C:\\Projects\\app', ...HOSTILE]) {
      for (const key of ALL) {
        const p = plan(key, dir, machine);
        assert.ok(isFull(p.file), `${key} launcher ${p.file}`);
        if (p.args[0] === '/c') {
          assert.ok(isFull(p.args[3]), `${key} program ${p.args[3]}`);
        }
      }
      for (const key of ADMIN) {
        const { launcher, inner } = scripts(plan(key, dir, machine).args);
        const [launched] = payloads(launcher);
        assert.ok(isFull(launched), `${key} elevated program ${launched}`);
        if (key === 'cmdAdmin') assert.ok(payloads(inner ?? '').includes(CMD), 'cmd runs from its full path');
      }
    }
  });

  test('system programs come from the Windows folder, wherever it is', () => {
    assert.strictEqual(systemExe('D:\\WIN', 'cmd.exe'), 'D:\\WIN\\System32\\cmd.exe');
    assert.strictEqual(systemExe('D:\\WIN', 'wsl.exe'), 'D:\\WIN\\System32\\wsl.exe');
    assert.strictEqual(systemExe('D:\\WIN', 'powershell.exe'), 'D:\\WIN\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.strictEqual(plan('powershell', 'C:\\x', { ...machine, systemRoot: 'D:\\WIN' }).file, 'D:\\WIN\\System32\\cmd.exe');
  });

  test("administrator shells go through Windows' own prompt, with the script encoded", () => {
    for (const key of ADMIN) {
      const p = plan(key, 'C:\\Projects\\app', machine);
      assert.strictEqual(p.file, PS, key);
      assert.deepStrictEqual(p.args.slice(0, 2), ['-NoProfile', '-EncodedCommand'], key);
      assert.strictEqual(p.args.length, 3, key);
      assert.match(scripts(p.args).launcher, /^Start-Process -FilePath \(\[System\.Text\.Encoding\]::UTF8\.GetString\(\[System\.Convert\]::FromBase64String\('[A-Za-z0-9+/=]+'\)\)\) -Verb RunAs -ArgumentList @\(/, key);
    }
  });

  test('each administrator shell elevates the right program and changes to the folder first', () => {
    const dir = 'C:\\Projects\\app';
    const ps = scripts(plan('powershellAdmin', dir, machine).args);
    assert.deepStrictEqual(payloads(ps.launcher), [PS]);
    assert.match(ps.launcher, /-ArgumentList @\('-NoExit','-EncodedCommand','[A-Za-z0-9+/=]+'\)$/);
    assert.match(ps.inner ?? '', /^Set-Location -LiteralPath \(\[System\.Text\.Encoding\]::UTF8\.GetString\(\[System\.Convert\]::FromBase64String\('[A-Za-z0-9+/=]+'\)\)\)$/);
    assert.deepStrictEqual(payloads(ps.inner ?? ''), [dir]);

    const cmd = scripts(plan('cmdAdmin', dir, machine).args);
    assert.deepStrictEqual(payloads(cmd.launcher), [PS]);
    assert.match(cmd.launcher, /-ArgumentList @\('-EncodedCommand','[A-Za-z0-9+/=]+'\)$/);
    assert.deepStrictEqual(payloads(cmd.inner ?? ''), [dir, CMD]);
    assert.match(cmd.inner ?? '', /; & \(\[System\.Text\.Encoding\]::UTF8.*\) \/k$/);

    const pwsh = scripts(plan('pwshAdmin', dir, machine).args);
    assert.deepStrictEqual(payloads(pwsh.launcher), [machine.pwsh]);
    assert.deepStrictEqual(payloads(pwsh.inner ?? ''), [dir]);
  });

  test('a folder name is only ever data: it never appears in any script as text', () => {
    for (const dir of HOSTILE) {
      for (const key of ADMIN) {
        const { launcher, inner } = scripts(plan(key, dir, machine).args);
        assert.ok(!launcher.includes(dir) && !(inner ?? '').includes(dir), `${key} ${dir}`);
        // Folder text only ever enters as base64, so a script is plain printable ASCII: no curly quote or any
        // other character PowerShell could read as a delimiter can come from a folder name.
        for (const script of [launcher, inner ?? '']) {
          assert.ok(/^[\x20-\x7E]*$/.test(script), `${key} ${dir}: non-ASCII in script`);
        }
        const folder = payloads(inner ?? '')[0];
        assert.strictEqual(folder, dir, `${key} ${dir}: the folder round-trips exactly`);
      }
    }
  });

  // The real PowerShell parser, on Windows only: whatever the folder is called, the script is the commands we
  // wrote and nothing more. The earlier check that looked only for ASCII apostrophes missed curly quotes.
  (process.platform === 'win32' ? test : test.skip)('PowerShell itself parses every script as only the commands we wrote', function () {
    this.timeout(60000);
    // One PowerShell run parses every script: it reports parse errors, statements and commands for each.
    const parse = (scripts: string[]) => {
      const probe =
        '$list=Get-Content -Raw -Encoding UTF8 $env:TW_SCRIPTS | ConvertFrom-Json;' +
        'foreach($x in $list){$e=$null;$t=$null;$a=[System.Management.Automation.Language.Parser]::ParseInput($x,[ref]$t,[ref]$e);' +
        '$c=$a.FindAll({param($n) $n -is [System.Management.Automation.Language.CommandAst]},$true).Count;' +
        '"$($e.Count) $($a.EndBlock.Statements.Count) $c"}';
      const file = path.join(os.tmpdir(), `tw-scripts-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
      fs.writeFileSync(file, JSON.stringify(scripts), 'utf8');
      try {
        const out = execFileSync(PS, ['-NoProfile', '-NonInteractive', '-Command', probe], { env: { ...process.env, TW_SCRIPTS: file }, encoding: 'utf8' });
        return out.trim().split(/\r?\n/);
      } finally {
        fs.rmSync(file, { force: true });
      }
    };
    const scriptsFor = HOSTILE.flatMap((dir) => [
      { dir, what: 'Set-Location only', expect: '0 1 1', text: scripts(plan('powershellAdmin', dir, machine).args).inner ?? '' },
      { dir, what: 'Set-Location then cmd only', expect: '0 2 2', text: scripts(plan('cmdAdmin', dir, machine).args).inner ?? '' },
      { dir, what: 'launcher is one Start-Process', expect: '0 1 1', text: scripts(plan('powershellAdmin', dir, machine).args).launcher },
    ]);
    const results = parse(scriptsFor.map((s) => s.text));
    assert.strictEqual(results.length, scriptsFor.length);
    // Each result reads: parse errors, then statements, then commands.
    scriptsFor.forEach((s, i) => assert.strictEqual(results[i], s.expect, `${s.what}: ${s.dir}`));
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
