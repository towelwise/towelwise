import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { available, plan, ShellKey, startDir } from '../shells';

const machine = { platform: 'win32', pwsh: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', gitBash: 'C:\\Program Files\\Git\\git-bash.exe', wslDistros: ['Ubuntu'] };
const nothing = { platform: 'win32', wslDistros: [] as string[] };

const utf16 = (b64: string) => Buffer.from(b64, 'base64').toString('utf16le');
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
// The script a launcher runs, then the script it hands to the elevated shell.
function scripts(args: string[]) {
  const launcher = utf16(after(args, '-EncodedCommand'));
  const inner = /'-EncodedCommand','([A-Za-z0-9+/=]+)'/.exec(launcher)?.[1];
  return { launcher, inner: inner === undefined ? undefined : utf16(inner) };
}
const HOSTILE = [
  "C:\\Users\\me\\it's mine",
  'C:\\Users\\me\\a;b',
  'C:\\Users\\me\\a&b',
  'C:\\Users\\me\\%PATH%',
  'C:\\Users\\me\\$x and $(calc)',
  'C:\\Users\\me\\with space',
  "C:\\x'; calc; '",
  "C:\\x''y",
];

suite('external shells', () => {
  test('plain shells start in the folder, with their own console window', () => {
    const dir = 'C:\\Projects\\my app';
    // The same way VS Code's own "Open New External Terminal" does it: `start` opens a new window, and the
    // folder is the working directory, never part of a command line.
    const start = (title: string, ...program: string[]) => ({ file: 'cmd.exe', args: ['/c', 'start', title, ...program], cwd: dir });
    assert.deepStrictEqual(plan('powershell', dir, machine), start('Towelwise PowerShell', 'powershell.exe', '-NoExit'));
    assert.deepStrictEqual(plan('cmd', dir, machine), start('Towelwise Command Prompt', 'cmd.exe', '/k'));
    assert.deepStrictEqual(plan('pwsh', dir, machine), start('Towelwise PowerShell 7', machine.pwsh, '-NoExit'));
    assert.deepStrictEqual(plan('gitbash', dir, machine), start('Towelwise Git Bash', machine.gitBash));
    assert.deepStrictEqual(plan('wsl', dir, machine), start('Towelwise WSL', 'wsl.exe'));
  });

  test('a shell that is not installed cannot be planned', () => {
    for (const key of ['pwsh', 'pwshAdmin', 'gitbash'] as ShellKey[]) {
      assert.throws(() => plan(key, 'C:\\x', nothing), Error, key);
    }
  });

  test('administrator shells go through Windows\' own prompt, with the script encoded', () => {
    for (const key of ['powershellAdmin', 'cmdAdmin', 'pwshAdmin'] as ShellKey[]) {
      const p = plan(key, 'C:\\Projects\\app', machine);
      assert.strictEqual(p.file, 'powershell.exe', key);
      assert.deepStrictEqual(p.args.slice(0, 2), ['-NoProfile', '-EncodedCommand'], key);
      assert.strictEqual(p.args.length, 3, key);
      assert.match(scripts(p.args).launcher, /^Start-Process -FilePath '[^']+' -Verb RunAs -ArgumentList @\(/, key);
    }
  });

  test('each administrator shell elevates the right program and changes to the folder first', () => {
    const dir = 'C:\\Projects\\app';
    const ps = scripts(plan('powershellAdmin', dir, machine).args);
    assert.strictEqual(ps.launcher, `Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @('-NoExit','-EncodedCommand','${Buffer.from(ps.inner ?? '', 'utf16le').toString('base64')}')`);
    assert.strictEqual(ps.inner, `Set-Location -LiteralPath 'C:\\Projects\\app'`);

    const cmd = scripts(plan('cmdAdmin', dir, machine).args);
    assert.match(cmd.launcher, /^Start-Process -FilePath 'powershell\.exe' -Verb RunAs -ArgumentList @\('-EncodedCommand',/);
    assert.strictEqual(cmd.inner, `Set-Location -LiteralPath 'C:\\Projects\\app'; & cmd.exe /k`);

    const pwsh = scripts(plan('pwshAdmin', dir, machine).args);
    assert.match(pwsh.launcher, /^Start-Process -FilePath 'C:\\Program Files\\PowerShell\\7\\pwsh\.exe' -Verb RunAs/);
    assert.strictEqual(pwsh.inner, `Set-Location -LiteralPath 'C:\\Projects\\app'`);
  });

  test('a folder name is only ever the folder: hostile names stay inside one quoted literal', () => {
    for (const dir of HOSTILE) {
      for (const key of ['powershellAdmin', 'cmdAdmin', 'pwshAdmin'] as ShellKey[]) {
        const inner = scripts(plan(key, dir, machine).args).inner ?? '';
        const literal = /^Set-Location -LiteralPath '((?:[^']|'')*)'(; & cmd\.exe \/k)?$/.exec(inner);
        assert.ok(literal, `${key} ${dir}: ${inner}`);
        assert.strictEqual(literal[1].replace(/''/g, "'"), dir, `${key} ${dir}`);
      }
      // The launcher itself never contains the folder, so it cannot be broken out of either.
      assert.ok(!scripts(plan('powershellAdmin', dir, machine).args).launcher.includes(dir));
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
    assert.deepStrictEqual(available({ platform: 'linux', wslDistros: [] }), []);
    assert.deepStrictEqual(available({ platform: 'darwin', pwsh: 'x', gitBash: 'y', wslDistros: ['Ubuntu'] }), []);
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
    for (const key of ['powershell', 'powershellAdmin', 'cmd', 'cmdAdmin', 'gitbash', 'pwsh', 'pwshAdmin', 'wsl']) {
      assert.ok(commands.includes(`towelwise.shell.${key}`), key);
    }
  });
});
