import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { Draft } from '../picker';
import { LayoutMode } from '../layoutMode';

const GLOBAL = vscode.ConfigurationTarget.Global;
const WORKSPACE = vscode.ConfigurationTarget.Workspace;
const key = (option: string) => `towelwise.hyperspace.${option}`;
const config = () => vscode.workspace.getConfiguration();
const globalOf = (option: string) => config().inspect(key(option))?.globalValue;
const ALL = [
  'hideActivityBar',
  'hideStatusBar',
  'hideMenuBar',
  'hideCommandCenter',
  'hideLayoutControls',
  'hidePrimarySideBar',
  'hideSecondarySideBar',
  'hideBottomPanel',
  'fullScreen',
];

suite('layout mode (extension side)', () => {
  let original: unknown[];

  setup(async () => {
    original = ALL.map(globalOf);
    for (const option of ALL) await config().update(key(option), undefined, GLOBAL);
  });

  teardown(async () => {
    for (const [i, option] of ALL.entries()) {
      await config().update(key(option), original[i], GLOBAL);
      await config().update(key(option), undefined, WORKSPACE);
    }
  });

  const spy = (failing: string[] = []) => {
    const writes: Array<[string, boolean]> = [];
    const write = async (option: string, value: boolean) => {
      if (failing.includes(option)) throw new Error(`cannot write ${option}`);
      writes.push([option, value]);
      await config().update(key(option), value, GLOBAL);
    };
    return { writes, make: () => new Draft(write) };
  };

  test('state reports the nine items with the values that apply, what is saved, and whether hyperspace is on', () => {
    const mode = new LayoutMode(() => new Draft(), () => true);
    const state = mode.state();
    assert.deepStrictEqual(state.items.map((i) => i.option), ALL);
    assert.strictEqual(state.items.find((i) => i.option === 'hideStatusBar')?.choice, 'hide');
    assert.strictEqual(state.items.find((i) => i.option === 'hidePrimarySideBar')?.choice, 'keep');
    assert.deepStrictEqual(state.saved, []);
    assert.strictEqual(state.hyperspaceOn, true);
  });

  test('choosing changes the draft and nothing else', async () => {
    const { writes, make } = spy();
    const mode = new LayoutMode(make, () => false);
    const after = mode.choose('hideStatusBar', 'keep');
    mode.choose('fullScreen', true);

    assert.strictEqual(after.items.find((i) => i.option === 'hideStatusBar')?.choice, 'keep');
    assert.strictEqual(mode.state().items.find((i) => i.option === 'fullScreen')?.on, true);
    assert.deepStrictEqual(writes, []);
    assert.deepStrictEqual(ALL.map(globalOf), ALL.map(() => undefined));
  });

  test('a request is checked as an option and value pair, and a bad one changes nothing', () => {
    const mode = new LayoutMode(() => new Draft(), () => false);
    const before = JSON.stringify(mode.state());
    const bad: Array<[unknown, unknown]> = [
      ['hideStatusBar', 'on'],
      ['hideStatusBar', true],
      ['hideStatusBar', undefined],
      ['fullScreen', 'hide'],
      ['fullScreen', 'true'],
      ['towelwise.layout.containers', 'hide'],
      ['editor.fontSize', true],
      ['hideEverything', 'hide'],
      [undefined, 'hide'],
      [42, 'keep'],
      [{ option: 'hideStatusBar' }, 'keep'],
    ];
    for (const [option, value] of bad) assert.throws(() => mode.choose(option, value), Error, JSON.stringify([option, value]));
    assert.strictEqual(JSON.stringify(mode.state()), before);
  });

  test('save writes only the edited options to user settings and lists what saved', async () => {
    const { writes, make } = spy();
    const mode = new LayoutMode(make, () => false);
    mode.choose('hideStatusBar', 'keep');
    mode.choose('hidePrimarySideBar', 'hide');

    const result = await mode.save();
    assert.deepStrictEqual(result.written, ['hideStatusBar', 'hidePrimarySideBar']);
    assert.deepStrictEqual(writes, [['hideStatusBar', false], ['hidePrimarySideBar', true]]);
    assert.deepStrictEqual(mode.state().saved, ['hideStatusBar', 'hidePrimarySideBar']);
    assert.strictEqual(globalOf('hideMenuBar'), undefined);
  });

  test('a failed write is reported with the draft kept, and a second save writes what is left', async () => {
    const failing = ['hideMenuBar'];
    const { writes, make } = spy(failing);
    const mode = new LayoutMode(make, () => false);
    mode.choose('hideStatusBar', 'keep');
    mode.choose('hideMenuBar', 'keep');

    const first = await mode.save();
    assert.strictEqual(first.failed?.option, 'hideMenuBar');
    assert.strictEqual(mode.state().items.find((i) => i.option === 'hideMenuBar')?.choice, 'keep');

    failing.length = 0;
    const again = await mode.save();
    assert.deepStrictEqual(again.written, ['hideMenuBar']);
    assert.deepStrictEqual(writes, [['hideStatusBar', false], ['hideMenuBar', false]]);
  });

  test('closing discards the draft without writing, and opening again starts fresh', async () => {
    const { writes, make } = spy();
    const mode = new LayoutMode(make, () => false);
    mode.choose('hideStatusBar', 'keep');
    mode.close();
    assert.strictEqual(mode.state().items.find((i) => i.option === 'hideStatusBar')?.choice, 'hide');

    mode.choose('hideStatusBar', 'keep');
    mode.open();
    assert.strictEqual(mode.state().items.find((i) => i.option === 'hideStatusBar')?.choice, 'hide');
    assert.deepStrictEqual(writes, []);
    assert.deepStrictEqual(ALL.map(globalOf), ALL.map(() => undefined));
  });

  test('a project override is marked, and the value that applies is shown', async () => {
    await config().update(key('hideStatusBar'), false, GLOBAL);
    await config().update(key('hideStatusBar'), true, WORKSPACE);

    const item = new LayoutMode(() => new Draft(), () => false).state().items.find((i) => i.option === 'hideStatusBar');
    assert.strictEqual(item?.overridden, true);
    assert.strictEqual(item?.choice, 'hide');
  });

  test('layout mode and the picker keep separate drafts, and a save in one shows in the other after it reopens', async () => {
    const mode = new LayoutMode(() => new Draft(), () => false);
    const picker = new Draft();
    mode.choose('hideStatusBar', 'keep');
    assert.strictEqual(picker.items().find((i) => i.option === 'hideStatusBar')?.choice, 'hide');

    await mode.save();
    assert.strictEqual(picker.items().find((i) => i.option === 'hideStatusBar')?.choice, 'hide');
    assert.strictEqual(new Draft().items().find((i) => i.option === 'hideStatusBar')?.choice, 'keep');
  });

  test('the commands are registered, and opening without the Towelwise AI patch is harmless', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of ['towelwise.layoutMode.open', 'towelwise.layoutMode.state', 'towelwise.layoutMode.choose', 'towelwise.layoutMode.save', 'towelwise.layoutMode.close']) {
      assert.ok(commands.includes(id), `${id} not registered`);
    }
    assert.ok(!commands.includes('towelwise.layoutMode.enter'), 'the core command should only exist in the patched app');
    await vscode.commands.executeCommand('towelwise.layoutMode.open');

    const state = (await vscode.commands.executeCommand('towelwise.layoutMode.state')) as { items: unknown[] };
    assert.strictEqual(state.items.length, 9);
    await assert.rejects(Promise.resolve(vscode.commands.executeCommand('towelwise.layoutMode.choose', 'fullScreen', 'hide')));
    await vscode.commands.executeCommand('towelwise.layoutMode.close');
  });
});
