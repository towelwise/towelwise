import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { AREAS, CHROME, restore, toggle } from '../hyperspace';
import { Draft, OPTIONS, pageHtml, parseMessage } from '../picker';

const GLOBAL = vscode.ConfigurationTarget.Global;
const WORKSPACE = vscode.ConfigurationTarget.Workspace;
const key = (option: string) => `towelwise.hyperspace.${option}`;
const config = () => vscode.workspace.getConfiguration();
const globalOf = (option: string) => config().inspect(key(option))?.globalValue;
const HIDE_OPTIONS = [
  'hideActivityBar',
  'hideStatusBar',
  'hideMenuBar',
  'hideCommandCenter',
  'hideLayoutControls',
  'hidePrimarySideBar',
  'hideSecondarySideBar',
  'hideBottomPanel',
];
const ALL = [...HIDE_OPTIONS, 'fullScreen'];
// The chrome settings that hyperspace itself changes, to check a picker Save never disturbs a restore.
const CHROME_KEYS = [
  'workbench.activityBar.location',
  'workbench.statusBar.visible',
  'window.menuBarVisibility',
  'window.commandCenter',
  'workbench.layoutControl.enabled',
];

suite('picker', () => {
  let original: unknown[];
  let originalChrome: unknown[];

  // Records every write instead of touching settings, and can fail chosen options.
  const spy = (failing: string[] = []) => {
    const writes: Array<[string, boolean]> = [];
    const write = async (option: string, value: boolean) => {
      if (failing.includes(option)) throw new Error(`cannot write ${option}`);
      writes.push([option, value]);
      await config().update(key(option), value, GLOBAL);
    };
    return { writes, write };
  };

  setup(async () => {
    original = ALL.map(globalOf);
    originalChrome = CHROME_KEYS.map((k) => config().inspect(k)?.globalValue);
    for (const option of ALL) await config().update(key(option), undefined, GLOBAL);
  });

  teardown(async () => {
    for (const [i, option] of ALL.entries()) {
      await config().update(key(option), original[i], GLOBAL);
      await config().update(key(option), undefined, WORKSPACE);
    }
    for (const [i, k] of CHROME_KEYS.entries()) await config().update(k, originalChrome[i], GLOBAL);
  });

  test('offers exactly the options hyperspace reads, so the two cannot drift apart', () => {
    assert.deepStrictEqual(HIDE_OPTIONS, [...CHROME, ...AREAS].map((o) => o.option));
  });

  test('lists the eight hide controls and full screen, from the current values', () => {
    const items = new Draft().items();
    assert.deepStrictEqual(items.map((i) => i.option), ALL);
    assert.deepStrictEqual(OPTIONS.map((o) => o.option), ALL);
    const choice = Object.fromEntries(items.map((i) => [i.option, i.kind === 'switch' ? (i.on ? 'on' : 'off') : i.choice]));
    assert.deepStrictEqual(choice, {
      hideActivityBar: 'hide',
      hideStatusBar: 'hide',
      hideMenuBar: 'hide',
      hideCommandCenter: 'hide',
      hideLayoutControls: 'hide',
      hidePrimarySideBar: 'keep',
      hideSecondarySideBar: 'keep',
      hideBottomPanel: 'hide',
      fullScreen: 'off',
    });
    assert.ok(items.every((i) => !i.overridden));
  });

  test('Hide means the option is on and Keep means it is off, in both directions', async () => {
    const { writes, write } = spy();
    const draft = new Draft(write);
    draft.choose('hideActivityBar', 'keep');
    draft.choose('hidePrimarySideBar', 'hide');
    await draft.save();
    assert.strictEqual(globalOf('hideActivityBar'), false);
    assert.strictEqual(globalOf('hidePrimarySideBar'), true);
    assert.deepStrictEqual(writes, [['hideActivityBar', false], ['hidePrimarySideBar', true]]);

    const reopened = new Draft().items();
    assert.strictEqual(reopened.find((i) => i.option === 'hideActivityBar')?.choice, 'keep');
    assert.strictEqual(reopened.find((i) => i.option === 'hidePrimarySideBar')?.choice, 'hide');
  });

  test('a saved value is shown the next time, and an untouched option stays unset', async () => {
    const draft = new Draft();
    draft.choose('hideStatusBar', 'keep');
    await draft.save();
    assert.strictEqual(globalOf('hideStatusBar'), false);
    for (const option of ALL.filter((o) => o !== 'hideStatusBar')) assert.strictEqual(globalOf(option), undefined, option);
  });

  test('saving with no edits, and toggling back, write nothing', async () => {
    const none = spy();
    await new Draft(none.write).save();
    assert.deepStrictEqual(none.writes, []);

    const back = spy();
    const draft = new Draft(back.write);
    draft.choose('hideMenuBar', 'keep');
    draft.choose('hideMenuBar', 'hide');
    draft.setFullScreen(true);
    draft.setFullScreen(false);
    assert.deepStrictEqual((await draft.save()).written, []);
    assert.deepStrictEqual(back.writes, []);
  });

  test('a draft that is never saved writes nothing', async () => {
    const draft = new Draft();
    draft.choose('hideStatusBar', 'keep');
    draft.setFullScreen(true);
    assert.deepStrictEqual(ALL.map(globalOf), ALL.map(() => undefined));
  });

  test('an option a project overrides shows the value that applies and is marked', async () => {
    await config().update(key('hideStatusBar'), false, GLOBAL);
    await config().update(key('hideStatusBar'), true, WORKSPACE);

    const item = new Draft().items().find((i) => i.option === 'hideStatusBar');
    assert.strictEqual(item?.choice, 'hide');
    assert.strictEqual(item?.overridden, true);
  });

  test('editing another option under an override leaves the untouched user value alone, set or unset', async () => {
    await config().update(key('hideStatusBar'), false, GLOBAL);
    await config().update(key('hideStatusBar'), true, WORKSPACE);
    await config().update(key('hideMenuBar'), undefined, GLOBAL);
    await config().update(key('hideMenuBar'), false, WORKSPACE);

    const { writes, write } = spy();
    const draft = new Draft(write);
    draft.choose('hideBottomPanel', 'keep');
    await draft.save();

    assert.deepStrictEqual(writes, [['hideBottomPanel', false]]);
    assert.strictEqual(globalOf('hideStatusBar'), false);
    assert.strictEqual(globalOf('hideMenuBar'), undefined);
  });

  test('an edited option whose user setting already matches is not written', async () => {
    await config().update(key('hideStatusBar'), false, GLOBAL);
    await config().update(key('hideStatusBar'), true, WORKSPACE);

    const { writes, write } = spy();
    const draft = new Draft(write);
    draft.choose('hideStatusBar', 'keep');
    const result = await draft.save();
    assert.deepStrictEqual(writes, []);
    assert.deepStrictEqual(result.written, []);
  });

  test('full screen is written as an on/off switch', async () => {
    const draft = new Draft();
    draft.setFullScreen(true);
    await draft.save();
    assert.strictEqual(globalOf('fullScreen'), true);
    assert.strictEqual(new Draft().items().find((i) => i.option === 'fullScreen')?.on, true);
  });

  test('a failed write names the option, keeps the draft, and a second Save writes only what is left', async () => {
    const failing = ['hideMenuBar'];
    const { writes, write } = spy(failing);
    const draft = new Draft(write);
    draft.choose('hideStatusBar', 'keep');
    draft.choose('hideMenuBar', 'keep');
    draft.choose('hideBottomPanel', 'keep');

    const first = await draft.save();
    assert.deepStrictEqual(first.written, ['hideStatusBar']);
    assert.strictEqual(first.failed?.option, 'hideMenuBar');
    assert.match(first.failed?.message ?? '', /cannot write hideMenuBar/);
    assert.strictEqual(draft.items().find((i) => i.option === 'hideBottomPanel')?.choice, 'keep');

    failing.length = 0;
    const again = await draft.save();
    assert.deepStrictEqual(writes.slice(1), [['hideMenuBar', false], ['hideBottomPanel', false]]);
    assert.deepStrictEqual(again.written, ['hideMenuBar', 'hideBottomPanel']);
    assert.strictEqual(again.failed, undefined);
  });

  test('a second Save pressed while the first is writing saves the later choice too', async () => {
    await config().update(key('hideStatusBar'), true, GLOBAL);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let started = 0;
    const write = async (option: string, value: boolean) => {
      started++;
      if (started === 1) await gate;
      await config().update(key(option), value, GLOBAL);
    };
    const draft = new Draft(write);

    draft.choose('hideStatusBar', 'keep');
    const first = draft.save();
    while (started === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    draft.choose('hideStatusBar', 'hide');
    const second = draft.save();
    release();
    await Promise.all([first, second]);

    assert.strictEqual(globalOf('hideStatusBar'), true);
    assert.strictEqual(draft.items().find((i) => i.option === 'hideStatusBar')?.choice, 'hide');
    assert.deepStrictEqual((await second).written, ['hideStatusBar']);
  });

  test('a choice made while a Save is writing is not lost', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let started = 0;
    const write = async (option: string, value: boolean) => {
      started++;
      if (started === 1) await gate;
      await config().update(key(option), value, GLOBAL);
    };
    const draft = new Draft(write);

    draft.choose('hideStatusBar', 'keep');
    const saving = draft.save();
    while (started === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    draft.choose('hideBottomPanel', 'keep');
    release();
    await saving;
    assert.strictEqual(globalOf('hideStatusBar'), false);
    assert.strictEqual(draft.items().find((i) => i.option === 'hideBottomPanel')?.choice, 'keep');

    await draft.save();
    assert.strictEqual(globalOf('hideBottomPanel'), false);
  });

  test('the draft remembers which options were saved, even when a later one failed', async () => {
    const failing = ['hideMenuBar'];
    const { write } = spy(failing);
    const draft = new Draft(write);
    assert.deepStrictEqual(draft.savedOptions(), []);

    draft.choose('hideStatusBar', 'keep');
    draft.choose('hideMenuBar', 'keep');
    draft.choose('hideBottomPanel', 'keep');
    await draft.save();
    assert.deepStrictEqual(draft.savedOptions(), ['hideStatusBar']);

    failing.length = 0;
    await draft.save();
    assert.deepStrictEqual(draft.savedOptions(), ['hideStatusBar', 'hideMenuBar', 'hideBottomPanel']);
  });

  test('only the nine options and boolean values are accepted', () => {
    const draft = new Draft();
    assert.throws(() => draft.choose('towelwise.layout.containers', 'hide'));
    assert.throws(() => draft.choose('hideEverything', 'hide'));
    assert.throws(() => draft.choose('fullScreen', 'hide'));
    assert.throws(() => draft.choose('hideStatusBar', 'maybe' as never));
    assert.throws(() => draft.setFullScreen('yes' as never));
  });

  test('page messages are checked before use', () => {
    assert.deepStrictEqual(parseMessage({ type: 'choose', option: 'hideStatusBar', choice: 'keep' }), {
      type: 'choose',
      option: 'hideStatusBar',
      choice: 'keep',
    });
    assert.deepStrictEqual(parseMessage({ type: 'fullScreen', on: true }), { type: 'fullScreen', on: true });
    for (const type of ['ready', 'save', 'cancel']) assert.deepStrictEqual(parseMessage({ type }), { type });
    for (const bad of [
      undefined,
      null,
      'save',
      {},
      { type: 'run', command: 'x' },
      { type: 'choose', option: 'editor.fontSize', choice: 'hide' },
      { type: 'choose', option: 'hideStatusBar', choice: 'show' },
      { type: 'choose', option: 'fullScreen', choice: 'hide' },
      { type: 'fullScreen', on: 'true' },
    ]) {
      assert.strictEqual(parseMessage(bad), undefined, JSON.stringify(bad));
    }
  });

  test('saving while hyperspace is on leaves its saved copy alone, and restore returns the settings exactly', async () => {
    const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'towelwise-'));
    try {
      const before = CHROME_KEYS.map((k) => config().inspect(k)?.globalValue);
      await toggle(storageDir);
      const snapshot = fs.readFileSync(path.join(storageDir, 'hyperspace.json'), 'utf8');

      const draft = new Draft();
      draft.choose('hideActivityBar', 'keep');
      await draft.save();
      assert.strictEqual(fs.readFileSync(path.join(storageDir, 'hyperspace.json'), 'utf8'), snapshot);

      await restore(storageDir);
      assert.deepStrictEqual(CHROME_KEYS.map((k) => config().inspect(k)?.globalValue), before);
    } finally {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }
  });

  test('the page loads nothing from the network and runs only its own script', () => {
    const html = pageHtml({ cspSource: 'vscode-webview://abc', nonce: 'n0nce', scriptUri: 'vscode-webview://abc/picker.js', styleUri: 'vscode-webview://abc/picker.css' });
    assert.match(html, /<meta http-equiv="Content-Security-Policy" content="[^"]*default-src 'none'/);
    assert.match(html, /script-src 'nonce-n0nce'/);
    assert.match(html, /<script nonce="n0nce" src="vscode-webview:\/\/abc\/picker\.js">/);
    assert.ok(!/https?:\/\//.test(html), 'the page names a network address');
    assert.ok(!/unsafe-inline|unsafe-eval/.test(html.replace(/style-src[^;"]*unsafe-inline/, '')), 'script policy is loose');
  });
});
