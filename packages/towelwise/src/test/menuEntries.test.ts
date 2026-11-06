import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { logMenuProblems, MenuEntry, validateEntries } from '../menuEntries';
import { SHELL_KEYS } from '../shells';

const manifest = () => vscode.extensions.getExtension('towelwise.towelwise')?.packageJSON;
const properties = () => Object.assign({}, ...manifest().contributes.configuration.map((c: { properties: object }) => c.properties));

const HIDDEN_DEFAULT: string[] = [];

suite('menu settings', () => {
  test('the hide list is a shipped, application-scoped list of strings with the agreed default', () => {
    const setting = properties()['towelwise.menus.hidden'];
    assert.strictEqual(setting.type, 'array');
    assert.strictEqual(setting.items.type, 'string');
    assert.strictEqual(setting.scope, 'application', 'a project must not decide what the IDE hides');
    assert.deepStrictEqual(setting.default, HIDDEN_DEFAULT);
  });

  test('every hide pattern is an exact command id, a prefix ending in a single *, or a menu: id', () => {
    for (const pattern of properties()['towelwise.menus.hidden'].default as string[]) {
      assert.ok(/^(menu:[A-Za-z][A-Za-z0-9._-]*|[A-Za-z][A-Za-z0-9._-]*\*?)$/.test(pattern) && (pattern.match(/\*/g) ?? []).length <= 1, pattern);
      if (pattern.includes('*')) assert.ok(pattern.endsWith('.*'), `${pattern}: a prefix should end at a dot`);
    }
  });

  test('the hide list schema accepts ids, dot-prefixes and menu: ids, and rejects the rest', () => {
    const pattern = new RegExp(properties()['towelwise.menus.hidden'].items.pattern);
    for (const ok of ['workbench.view.debug', 'workbench.action.tasks.*', 'terminal.integrated.*', 'menu:MenubarLayoutMenu']) assert.ok(pattern.test(ok), ok);
    for (const bad of ['', 'menu:', 'menu:*', 'menu:Menubar*', 'menu:A.*', 'a*b', '*', 'a.**', ' workbench.view.debug', 'menu: X']) assert.ok(!pattern.test(bad), JSON.stringify(bad));
  });

  test('the menu entries setting is application-scoped and its schema matches the contract', () => {
    const setting = properties()['towelwise.menus.towelwise'];
    assert.strictEqual(setting.type, 'array');
    assert.strictEqual(setting.scope, 'application');
    assert.strictEqual(setting.items.type, 'object');
    assert.deepStrictEqual([...setting.items.required].sort(), ['command', 'title']);
    assert.deepStrictEqual(Object.keys(setting.items.properties).sort(), ['command', 'group', 'title', 'when']);
    for (const field of ['command', 'title', 'group', 'when']) assert.strictEqual(setting.items.properties[field].type, 'string', field);
  });

  test('the default menu validates against the contract, with nothing skipped', () => {
    const { entries, problems } = validateEntries(properties()['towelwise.menus.towelwise'].default);
    assert.deepStrictEqual(problems, []);
    assert.strictEqual(entries.length, properties()['towelwise.menus.towelwise'].default.length);
  });

  test('the default menu is the agreed one, in the agreed order', () => {
    const entries: MenuEntry[] = validateEntries(properties()['towelwise.menus.towelwise'].default).entries;
    assert.deepStrictEqual(
      entries.map((e) => [e.group, e.command]),
      [
        ['hyperspace', 'towelwise.hyperspace.toggle'],
        ['hyperspace', 'towelwise.hyperspace.edit'],
        ['layout', 'towelwise.layout.choose'],
        ['layout', 'towelwise.layout.restore'],
        ['shells', 'towelwise.shell.powershell'],
        ['shells', 'towelwise.shell.powershellAdmin'],
        ['shells', 'towelwise.shell.cmd'],
        ['shells', 'towelwise.shell.cmdAdmin'],
        ['shells', 'towelwise.shell.gitbash'],
        ['shells', 'towelwise.shell.pwsh'],
        ['shells', 'towelwise.shell.pwshAdmin'],
        ['shells', 'towelwise.shell.wsl'],
      ],
    );
  });

  test('every command in the menu is one the extension contributes, so the menu cannot point at nothing', () => {
    const contributed = new Set(manifest().contributes.commands.map((c: { command: string }) => c.command));
    for (const entry of validateEntries(properties()['towelwise.menus.towelwise'].default).entries) {
      assert.ok(contributed.has(entry.command), entry.command);
    }
  });

  test('shell entries are gated by the same availability keys the extension sets, and the same as their palette entries', () => {
    const palette: Array<{ command: string; when: string }> = manifest().contributes.menus.commandPalette;
    const keys = new Set(SHELL_KEYS.map((k) => `towelwise.shell.available.${k}`));
    for (const entry of validateEntries(properties()['towelwise.menus.towelwise'].default).entries) {
      if (!entry.command.startsWith('towelwise.shell.')) {
        assert.strictEqual(entry.when, undefined, `${entry.command} needs no condition`);
        continue;
      }
      assert.ok(entry.when && keys.has(entry.when), `${entry.command}: ${entry.when}`);
      assert.strictEqual(entry.when, palette.find((p) => p.command === entry.command)?.when, entry.command);
    }
  });

  test('the menu gets no keyboard shortcuts of its own', () => {
    const bound = new Set(manifest().contributes.keybindings.map((k: { command: string }) => k.command));
    assert.ok(!bound.has('towelwise.shell.powershell') && !bound.has('towelwise.shell.cmdAdmin'));
  });
});

suite('menu entries validator', () => {
  test('good entries are kept in order, with optional fields', () => {
    const { entries, problems } = validateEntries([
      { command: 'a.b', title: 'First', group: 'one' },
      { command: 'c.d', title: '&Second', when: 'foo && !bar' },
      { command: 'e.f', title: 'Third', group: 'two', when: 'x', unknown: 42 },
    ]);
    assert.deepStrictEqual(problems, []);
    // The second entry has no group of its own, so it follows the first; unknown fields are dropped.
    assert.deepStrictEqual(entries, [
      { command: 'a.b', title: 'First', group: 'one' },
      { command: 'c.d', title: '&Second', group: 'one', when: 'foo && !bar' },
      { command: 'e.f', title: 'Third', group: 'two', when: 'x' },
    ]);
  });

  test('a group left out follows the previous entry, so a change of group is the only separator', () => {
    const { entries } = validateEntries([
      { command: 'a', title: 'A', group: 'one' },
      { command: 'b', title: 'B' },
      { command: 'c', title: 'C', group: 'two' },
      { command: 'd', title: 'D' },
    ]);
    assert.deepStrictEqual(entries.map((e) => e.group), ['one', 'one', 'two', 'two']);
  });

  test('a first entry with no group gets the empty group', () => {
    assert.deepStrictEqual(validateEntries([{ command: 'a', title: 'A' }]).entries[0].group, '');
  });

  test('each kind of malformed entry is skipped with a problem naming its position, and the rest survive', () => {
    const bad: Array<[unknown, RegExp]> = [
      ['text', /entry 2.*object/],
      [null, /entry 2.*object/],
      [[1, 2], /entry 2.*object/],
      [{ title: 'No command' }, /entry 2.*command/],
      [{ command: 'x' }, /entry 2.*title/],
      [{ command: '', title: 'Empty command' }, /entry 2.*command/],
      [{ command: 'x', title: '   ' }, /entry 2.*title/],
      [{ command: 42, title: 'Number command' }, /entry 2.*command/],
      [{ command: 'x', title: 'T', group: 5 }, /entry 2.*group/],
      [{ command: 'x', title: 'T', when: false }, /entry 2.*when/],
      [{ command: 'x', title: 'T', when: '' }, /entry 2.*when/],
      [{ command: 'x', title: 'T', when: '&& foo' }, /entry 2.*when/],
      [{ command: 'x', title: 'T', when: 'foo ||' }, /entry 2.*when/],
      [{ command: 'x', title: 'T', when: 'foo && && bar' }, /entry 2.*when/],
      [{ command: 'x', title: 'T', when: '(foo && bar' }, /entry 2.*when/],
      [{ command: 'x', title: 'T', when: 'foo)' }, /entry 2.*when/],
    ];
    for (const [entry, expected] of bad) {
      const { entries, problems } = validateEntries([{ command: 'ok1', title: 'Keep 1' }, entry, { command: 'ok2', title: 'Keep 2' }]);
      assert.deepStrictEqual(entries.map((e) => e.command), ['ok1', 'ok2'], JSON.stringify(entry));
      assert.strictEqual(problems.length, 1, JSON.stringify(entry));
      assert.match(problems[0], expected, JSON.stringify(entry));
    }
  });

  test('context-key expressions that look right are accepted', () => {
    for (const when of ['a', '!a', 'a && b', 'a || b', '(a || b) && !c', "a == 'x'", 'a != b', 'config.towelwise.x', 'a =~ /re/']) {
      const { entries, problems } = validateEntries([{ command: 'x', title: 'T', when }]);
      assert.deepStrictEqual(problems, [], when);
      assert.strictEqual(entries.length, 1, when);
    }
  });

  // Found in review: brackets and && inside quotes or a regular expression are text, not syntax, and the real
  // parser accepts these. The check must not report them as skipped.
  test('brackets and operators inside quotes or a regular expression are not counted', () => {
    for (const when of [
      "resourceFilename == 'a(b'",
      'resourceFilename == "a)b"',
      'resourceFilename =~ /\\(/',
      'resourceFilename =~ /a|b/ && foo',
      'resourceFilename =~ /a\\/b(/i',
      "x == 'a && b'",
      'x == "a || b" && y',
      "x == 'it\\'s (fine'",
      "(a == '(') || (b =~ /\\)/)",
      // Found in the second review: a / inside a character class does not end the expression.
      'resourcePath =~ /[/)]/',
      'resourcePath =~ /[/]foo\\(/',
      'resourcePath =~ /[\\]/(]/ && foo',
    ]) {
      const { entries, problems } = validateEntries([{ command: 'x', title: 'T', when }]);
      assert.deepStrictEqual(problems, [], when);
      assert.strictEqual(entries.length, 1, when);
    }
  });

  test('a real mistake is still caught when quotes and regular expressions are present', () => {
    for (const when of ["x == 'a(b' &&", "&& x == 'a'", "(x == 'a(b'", "x == 'a(b')) ", 'x =~ /a(/ || || y', 'x =~ /[/)]/ &&', 'x =~ /[/]/ || || y']) {
      const { entries, problems } = validateEntries([{ command: 'x', title: 'T', when }]);
      assert.strictEqual(entries.length, 0, when);
      assert.strictEqual(problems.length, 1, when);
    }
  });

  test('something that is not a list is one problem and no entries', () => {
    for (const raw of [undefined, null, 'text', 5, {}, { command: 'x', title: 'T' }]) {
      const { entries, problems } = validateEntries(raw);
      assert.deepStrictEqual(entries, [], JSON.stringify(raw));
      assert.strictEqual(problems.length, 1, JSON.stringify(raw));
      assert.match(problems[0], /list/, JSON.stringify(raw));
    }
  });

  test('a mistake in the setting is logged once per bad entry, naming it, and a good setting logs nothing', () => {
    const lines: string[] = [];
    logMenuProblems([{ command: 'ok', title: 'Fine' }, { title: 'No command' }, 'text', { command: 'x', title: 'T', when: '&& y' }], (l) => lines.push(l));
    assert.strictEqual(lines.length, 3);
    assert.match(lines[0], /entry 2.*command.*skipped/);
    assert.match(lines[1], /entry 3.*object.*skipped/);
    assert.match(lines[2], /entry 4.*when.*skipped/);

    const quiet: string[] = [];
    logMenuProblems(properties()['towelwise.menus.towelwise'].default, (l) => quiet.push(l));
    assert.deepStrictEqual(quiet, []);
  });

  test('an empty list is valid and shows an empty menu', () => {
    assert.deepStrictEqual(validateEntries([]), { entries: [], problems: [] });
  });
});
