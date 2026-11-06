import * as assert from 'node:assert';
import * as path from 'node:path';
import { launchOf, parseCellTerminal, planTerminal, shellsOn, terminalName } from '../cellTerminal';
import { Column, assign, fromSavedGrid, setTerminal, toSavedGrid } from '../columns';
import { parseSavedGrid } from '../grid';
import { LayoutDraft, LayoutEnv, parseLayoutMessage } from '../layoutDraft';
import { Machine } from '../shells';

const windows = (more: Partial<Machine> = {}): Machine => ({ platform: 'win32', systemRoot: 'C:\\Windows', wslDistros: [], ...more });
const full = windows({ pwsh: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', gitBash: 'C:\\Program Files\\Git\\git-bash.exe', wslDistros: ['Ubuntu'] });
const root = path.resolve('ws');
const second = path.resolve('ws2');

suite('cell terminals', () => {
  suite('parseCellTerminal', () => {
    test('keeps the fields given, trimmed, and drops empty ones and the default shell', () => {
      assert.deepStrictEqual(parseCellTerminal({ shell: 'gitbash', name: ' Dev ', folder: '', command: 'npm run dev' }), {
        shell: 'gitbash',
        name: 'Dev',
        command: 'npm run dev',
      });
      assert.deepStrictEqual(parseCellTerminal({ shell: 'default', name: '  ' }), {});
    });

    test('rejects what does not fit', () => {
      for (const bad of [null, 'gitbash', [], { shell: 'bash' }, { shell: 'powershellAdmin' }, { name: 3 }, { command: ['ls'] }]) {
        assert.strictEqual(parseCellTerminal(bad), undefined, JSON.stringify(bad));
      }
    });
  });

  test('a terminal is named as given, or after its shell', () => {
    assert.strictEqual(terminalName({ name: 'Dev server', shell: 'cmd' }), 'Dev server');
    assert.strictEqual(terminalName({ shell: 'gitbash' }), 'Git Bash');
    assert.strictEqual(terminalName({}), 'Terminal');
  });

  suite('shells on this machine', () => {
    test('Default, then the regular shells found; never an administrator one', () => {
      assert.deepStrictEqual(shellsOn(full), ['default', 'powershell', 'cmd', 'gitbash', 'pwsh', 'wsl']);
      assert.deepStrictEqual(shellsOn(windows()), ['default', 'powershell', 'cmd']);
      assert.deepStrictEqual(shellsOn({ platform: 'darwin', systemRoot: '', wslDistros: [] }), ['default']);
    });

    test('each opens its program by full path; Git Bash runs the bash.exe beside git-bash.exe', () => {
      assert.deepStrictEqual(launchOf('default', full), {});
      assert.deepStrictEqual(launchOf('powershell', full), { shellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' });
      assert.deepStrictEqual(launchOf('cmd', full), { shellPath: 'C:\\Windows\\System32\\cmd.exe' });
      assert.deepStrictEqual(launchOf('pwsh', full), { shellPath: full.pwsh });
      assert.deepStrictEqual(launchOf('gitbash', full), { shellPath: 'C:\\Program Files\\Git\\bin\\bash.exe', shellArgs: ['--login', '-i'] });
      assert.deepStrictEqual(launchOf('wsl', full), { shellPath: 'C:\\Windows\\System32\\wsl.exe' });
      assert.strictEqual(launchOf('gitbash', windows()), undefined);
      assert.strictEqual(launchOf('wsl', windows()), undefined);
    });
  });

  suite('planTerminal', () => {
    const exists = (p: string) => p === path.join(root, 'packages', 'web');

    test('opens the shell, named, in the folder under the workspace, with the command', () => {
      const plan = planTerminal({ shell: 'cmd', name: 'Web', folder: 'packages/web', command: 'npm run dev' }, full, [root], exists);
      assert.deepStrictEqual(plan, {
        open: { name: 'Web', shellPath: 'C:\\Windows\\System32\\cmd.exe', cwd: path.join(root, 'packages', 'web'), command: 'npm run dev' },
        problems: [],
      });
    });

    test('a shell not on this machine opens as the default one, and says so', () => {
      const plan = planTerminal({ shell: 'gitbash' }, windows(), [root], exists);
      assert.deepStrictEqual(plan.open, { name: 'Git Bash', cwd: root });
      assert.deepStrictEqual(plan.problems, ['Git Bash: Git Bash was not found on this machine, so it opened in the default shell']);
    });

    test('a folder that does not exist, or a relative one with no workspace, opens in the workspace folder, and says so', () => {
      const missing = planTerminal({ folder: 'nope' }, full, [root], exists);
      assert.strictEqual(missing.open.cwd, root);
      assert.deepStrictEqual(missing.problems, ['Terminal: the folder "nope" was not found, so it opened in the workspace folder']);
      assert.strictEqual(planTerminal({ folder: 'packages/web' }, full, [], exists).problems.length, 1);
    });

    test('in a multi-root workspace it always starts in the first folder, never whichever root was last active', () => {
      const missing = planTerminal({ folder: 'nope', command: 'npm run dev' }, full, [root, second], exists);
      assert.strictEqual(missing.open.cwd, root);
      assert.strictEqual(missing.problems.length, 1);
      assert.strictEqual(planTerminal({ command: 'npm run dev' }, full, [root, second], exists).open.cwd, root);
      assert.strictEqual(planTerminal({ folder: 'packages/web' }, full, [root, second], exists).open.cwd, path.join(root, 'packages', 'web'));
    });

    test('with no workspace open and no folder chosen, VS Code picks the folder', () => {
      assert.strictEqual(planTerminal({ command: 'ls' }, full, [], exists).open.cwd, undefined);
    });

    test('in a project that is not trusted, the terminal opens without its startup command, and says so', () => {
      const plan = planTerminal({ shell: 'cmd', name: 'Web', folder: 'packages/web', command: 'npm run dev' }, full, [root], exists, false);
      assert.deepStrictEqual(plan.open, { name: 'Web', shellPath: 'C:\\Windows\\System32\\cmd.exe', cwd: path.join(root, 'packages', 'web') });
      assert.deepStrictEqual(plan.problems, ['Web: its startup command did not run, because this project is not trusted. Trust it and reload the window to run it']);
      assert.deepStrictEqual(planTerminal({ name: 'Shell' }, full, [root], exists, false).problems, [], 'nothing to say without a command');
    });

    test('an absolute folder is used as it is', () => {
      const abs = path.join(root, 'packages', 'web');
      assert.strictEqual(planTerminal({ folder: abs }, full, [], exists).open.cwd, abs);
    });
  });

  suite('in the saved grid', () => {
    const grid = (terminal: unknown, holds = 'terminal') => ({ orientation: 0, groups: [{ size: 1, holds, terminal }] });

    test('a terminal cell keeps its terminal; an empty one is left out', () => {
      const logs: string[] = [];
      assert.deepStrictEqual(parseSavedGrid(grid({ shell: 'wsl', command: 'ls' }), (l) => logs.push(l))?.groups, [
        { size: 1, holds: 'terminal', terminal: { shell: 'wsl', command: 'ls' } },
      ]);
      assert.deepStrictEqual(parseSavedGrid(grid({}), (l) => logs.push(l))?.groups, [{ size: 1, holds: 'terminal' }]);
      assert.deepStrictEqual(logs, []);
    });

    test('a terminal that does not fit, or one on a cell that is not a terminal, makes the grid invalid and is logged', () => {
      for (const bad of [grid({ shell: 'fish' }), grid({ name: 1 }), grid({ name: 'x' }, 'codex')]) {
        const logs: string[] = [];
        assert.strictEqual(parseSavedGrid(bad, (l) => logs.push(l)), undefined, JSON.stringify(bad));
        assert.strictEqual(logs.length, 1);
      }
    });
  });

  suite('in the builder', () => {
    const one = (): Column[] => [{ size: 1, rows: [{ size: 0.5, holds: 'terminal' }, { size: 0.5 }] }];

    test('a terminal cell takes a terminal, which round-trips through the saved grid', () => {
      const cols = setTerminal(one(), 0, 0, { shell: 'pwsh', name: 'Tests' });
      assert.deepStrictEqual(fromSavedGrid(toSavedGrid(cols)), cols);
      assert.deepStrictEqual(toSavedGrid(cols).groups[0].groups?.[0], { size: 0.5, holds: 'terminal', terminal: { shell: 'pwsh', name: 'Tests' } });
    });

    test('an empty terminal is the default and is not stored; a cell that is not a terminal takes none', () => {
      assert.deepStrictEqual(setTerminal(setTerminal(one(), 0, 0, { name: 'x' }), 0, 0, {})[0].rows[0], { size: 0.5, holds: 'terminal' });
      assert.deepStrictEqual(setTerminal(one(), 0, 1, { name: 'x' })[0].rows[1], { size: 0.5 });
    });

    test('a cell that stops holding a terminal drops its terminal; choosing Terminal again keeps it', () => {
      const cols = setTerminal(one(), 0, 0, { name: 'x' });
      assert.deepStrictEqual(assign(cols, 0, 0, undefined)[0].rows[0], { size: 0.5 });
      assert.deepStrictEqual(assign(cols, 0, 0, 'terminal')[0].rows[0].terminal, { name: 'x' });
    });
  });

  suite('on the Choose Layout page', () => {
    function draftWith() {
      const writes: { grid: object }[] = [];
      const env: LayoutEnv = { read: async () => undefined, write: async (values) => void writes.push(values) };
      const draft = new LayoutDraft({ grid: toSavedGrid([{ size: 1, rows: [{ size: 1, holds: 'terminal', terminal: { shell: 'gitbash' } }] }]) }, env);
      const cell = () => draft.view().grid.columns![0].rows[0];
      return { draft, writes, cell };
    }

    test('a terminal cell shows its fields; until the shells are known only Default and the saved one are offered', () => {
      const { cell } = draftWith();
      assert.deepStrictEqual(cell().terminal, {
        shell: 'gitbash',
        name: '',
        folder: '',
        command: '',
        placeholder: 'Git Bash',
        shells: [
          { value: 'default', label: 'Terminal' },
          { value: 'gitbash', label: 'Git Bash' },
        ],
      });
    });

    test("then it offers this machine's shells, and marks a saved one that is not among them", () => {
      const { draft, cell } = draftWith();
      draft.setShells(['default', 'powershell', 'cmd']);
      assert.deepStrictEqual(
        cell().terminal?.shells.map((s) => s.label),
        ['Terminal', 'PowerShell', 'Command Prompt', 'Git Bash (not found)'],
      );
    });

    test('a cell that is not a terminal shows no terminal fields', () => {
      const env: LayoutEnv = { read: async () => undefined, write: async () => undefined };
      const draft = new LayoutDraft({ grid: toSavedGrid([{ size: 1, rows: [{ size: 1 }] }]) }, env);
      assert.strictEqual('terminal' in draft.view().grid.columns![0].rows[0], false);
    });

    test('the terminal typed on the page is saved with its cell', async () => {
      const { draft, writes } = draftWith();
      const message = parseLayoutMessage({ type: 'terminal', column: 0, row: 0, terminal: { shell: 'cmd', name: 'Build', folder: '', command: 'npm run build' } });
      assert.deepStrictEqual(message, { type: 'terminal', column: 0, row: 0, terminal: { shell: 'cmd', name: 'Build', command: 'npm run build' } });
      if (message?.type !== 'terminal') return;
      draft.setTerminal(message.column, message.row, message.terminal);
      assert.deepStrictEqual(await draft.save(), { ok: true });
      assert.deepStrictEqual(writes[0].grid, {
        orientation: 0,
        groups: [{ size: 1, holds: 'terminal', terminal: { shell: 'cmd', name: 'Build', command: 'npm run build' } }],
      });
    });

    test('a terminal message that does not fit is dropped', () => {
      for (const bad of [
        { type: 'terminal', column: 0, row: 0, terminal: { shell: 'zsh' } },
        { type: 'terminal', column: -1, row: 0, terminal: {} },
        { type: 'terminal', column: 0, row: 0 },
      ]) {
        assert.strictEqual(parseLayoutMessage(bad), undefined, JSON.stringify(bad));
      }
    });
  });
});
