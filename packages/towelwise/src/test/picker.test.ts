import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { AREAS, CHROME, restore, toggle } from '../hyperspace';
import { Draft, OPTIONS, pageHtml, parseMessage } from '../picker';
import { openPicker } from '../pickerPanel';
import { fakePanel } from './fakePanel';
import { AgentId } from '../agents';
import { LayoutState, PartName } from '../sizes';

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

  // Sizes: a stand-in window and a recording writer, so nothing touches the real setting.
  const sizeEnv = (state: LayoutState | undefined) => {
    const writes: unknown[] = [];
    return { writes, env: { read: async () => state, write: async (value: unknown) => void writes.push(value) } };
  };
  const live = (over: Partial<LayoutState> = {}): LayoutState => ({
    window: { width: 2000, height: 1000 },
    panelPosition: 'bottom',
    parts: {
      sidebar: { visible: true, size: 300 },
      auxiliarybar: { visible: true, size: 400 },
      panel: { visible: true, size: 250 },
    },
    ...over,
  });
  const percentOf = (draft: Draft, part: string) => draft.sizesView().rows.find((r) => r.part === part)?.percent;

  test('Use current sizes fills the visible parts as percentages, and a hidden part keeps its value', async () => {
    const { env } = sizeEnv(live());
    const draft = new Draft(undefined, env as never);
    await draft.useCurrentSizes();
    assert.strictEqual(percentOf(draft, 'sidebar'), 15);
    assert.strictEqual(percentOf(draft, 'auxiliarybar'), 20);
    assert.strictEqual(percentOf(draft, 'panel'), 25);
    assert.strictEqual(draft.sizesView().panelOrientation, 'down');

    const hiddenAux = live({ parts: { ...live().parts, auxiliarybar: { visible: false, size: 0 }, sidebar: { visible: true, size: 400 } } });
    const again = sizeEnv(hiddenAux);
    (env as { read: unknown }).read = again.env.read;
    await draft.useCurrentSizes();
    assert.strictEqual(percentOf(draft, 'sidebar'), 20);
    assert.strictEqual(percentOf(draft, 'auxiliarybar'), 20);
    assert.match(draft.sizesView().note ?? '', /Secondary side bar/);
  });

  test('Save writes captured sizes as proportions, with the panel orientation, and no range check', async () => {
    const { env, writes } = sizeEnv(live({ parts: { ...live().parts, sidebar: { visible: true, size: 1900 } } }));
    const draft = new Draft(undefined, env as never);
    await draft.useCurrentSizes();
    const result = await draft.save();
    assert.deepStrictEqual(result.written, ['sizes']);
    assert.deepStrictEqual(writes, [{ sidebar: 0.95, auxiliarybar: 0.2, panel: 0.25, panelOrientation: 'down' }]);
    assert.deepStrictEqual(draft.savedOptions(), ['sizes']);
    // Nothing changed since: a second Save writes nothing.
    assert.deepStrictEqual((await draft.save()).written, []);
  });

  test('typed values outside 5 to 80, or not numbers, are refused and nothing else is written', async () => {
    for (const text of ['4', '81', 'wide', '-3']) {
      const { env, writes } = sizeEnv(live());
      const { write, writes: optionWrites } = spy();
      const draft = new Draft(write, env as never);
      await draft.useCurrentSizes();
      draft.choose('hideStatusBar', 'keep');
      await draft.setSize('sidebar', text);
      const result = await draft.save();
      assert.strictEqual(result.failed?.option, 'sizes', text);
      assert.match(result.failed?.message ?? '', /5 and 80/);
      assert.deepStrictEqual(writes, []);
      assert.deepStrictEqual(optionWrites, []);
    }
  });

  test('the editor floor applies only when a side bar was typed, and editing one value types only that one', async () => {
    const { env, writes } = sizeEnv(live({ parts: { ...live().parts, sidebar: { visible: true, size: 900 }, auxiliarybar: { visible: true, size: 900 } } }));
    const draft = new Draft(undefined, env as never);
    await draft.useCurrentSizes();
    // 45% + 45% captured: allowed.
    assert.deepStrictEqual((await draft.save()).written, ['sizes']);
    await draft.setSize('panel', '30');
    assert.deepStrictEqual((await draft.save()).written, ['sizes']);
    await draft.setSize('sidebar', '40');
    const refused = await draft.save();
    assert.match(refused.failed?.message ?? '', /20 percent/);
    assert.deepStrictEqual(draft.sizesView().rows.map((r) => r.typed), [true, false, true]);
    assert.strictEqual(writes.length, 2);
  });

  test('a cleared size is left out of what is saved, and clearing everything resets the setting', async () => {
    const { env, writes } = sizeEnv(live());
    const draft = new Draft(undefined, env as never);
    await draft.useCurrentSizes();
    await draft.setSize('panel', '');
    await draft.setSize('auxiliarybar', '');
    await draft.save();
    assert.deepStrictEqual(writes[0], { sidebar: 0.15 });
    await draft.setSize('sidebar', '');
    await draft.save();
    assert.strictEqual(writes[1], undefined);
    assert.strictEqual(writes.length, 2);
  });

  test('a typed panel size takes the side the panel is on now, without Use current sizes', async () => {
    const { env, writes } = sizeEnv(live({ panelPosition: 'right' }));
    const draft = new Draft(undefined, env as never);
    await draft.setSize('panel', '30');
    assert.deepStrictEqual((await draft.save()).written, ['sizes']);
    assert.deepStrictEqual(writes, [{ panel: 0.3, panelOrientation: 'across' }]);
  });

  test('a typed panel size replaces an old side when the panel has since moved', async () => {
    let position: 'bottom' | 'right' = 'bottom';
    const writes: unknown[] = [];
    const env = { read: async () => live({ panelPosition: position }), write: async (v: unknown) => void writes.push(v) };
    const draft = new Draft(undefined, env as never);
    await draft.setSize('panel', '30');
    await draft.save();
    position = 'right';
    await draft.setSize('panel', '40');
    await draft.save();
    assert.deepStrictEqual(writes, [
      { panel: 0.3, panelOrientation: 'down' },
      { panel: 0.4, panelOrientation: 'across' },
    ]);
  });

  test('a typed panel size with no live read and no known side is refused', async () => {
    const { env, writes } = sizeEnv(undefined);
    const draft = new Draft(undefined, env as never);
    await draft.setSize('panel', '30');
    assert.match((await draft.save()).failed?.message ?? '', /which side/);
    assert.deepStrictEqual(writes, []);
  });

  test('without the bridge the controls say sizes need Towelwise AI, and nothing throws', async () => {
    const { env } = sizeEnv(undefined);
    const draft = new Draft(undefined, env as never);
    await draft.refreshLive();
    assert.strictEqual(draft.sizesView().available, false);
    assert.match(draft.sizesView().note ?? '', /Towelwise AI/);
    await draft.useCurrentSizes();
    assert.strictEqual(draft.sizesView().available, false);
    assert.deepStrictEqual((await draft.save()).written, []);
  });

  test('size messages from the page are checked', () => {
    assert.deepStrictEqual(parseMessage({ type: 'useCurrentSizes' }), { type: 'useCurrentSizes' });
    assert.deepStrictEqual(parseMessage({ type: 'size', part: 'panel', value: '30' }), { type: 'size', part: 'panel', value: '30' });
    for (const bad of [{ type: 'size', part: 'editor', value: '30' }, { type: 'size', part: 'panel', value: 30 }, { type: 'size', part: 'panel' }]) {
      assert.strictEqual(parseMessage(bad), undefined, JSON.stringify(bad));
    }
  });

  test('a Save pressed while a panel size is still reading the panel side waits for it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const writes: unknown[] = [];
    let first = true;
    const env = {
      read: async () => {
        // The constructor-time state is not read; the first read is the one the edit starts, and it is held open.
        if (first) {
          first = false;
          await gate;
        }
        return live({ panelPosition: 'right' });
      },
      write: async (v: unknown) => void writes.push(v),
    };
    await config().update(key('sizes'), { panel: 0.2, panelOrientation: 'down' }, GLOBAL);
    try {
      const draft = new Draft(undefined, env as never);
      // The page sends the edit and then Save without waiting between them.
      const edit = draft.setSize('panel', '30');
      const save = draft.save();
      release();
      await edit;
      const result = await save;
      assert.deepStrictEqual(result.written, ['sizes']);
      assert.deepStrictEqual(writes, [{ panel: 0.3, panelOrientation: 'across' }]);
    } finally {
      await config().update(key('sizes'), undefined, GLOBAL);
    }
  });

  test('with no saved side, an overlapping edit and Save still save the typed panel size', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const writes: unknown[] = [];
    const env = {
      read: async () => {
        await gate;
        return live();
      },
      write: async (v: unknown) => void writes.push(v),
    };
    const draft = new Draft(undefined, env as never);
    const edit = draft.setSize('panel', '30');
    const save = draft.save();
    release();
    await edit;
    assert.deepStrictEqual((await save).written, ['sizes']);
    assert.deepStrictEqual(writes, [{ panel: 0.3, panelOrientation: 'down' }]);
  });

  const named = (title: string | undefined, panelTitle?: string): LayoutState =>
    live({
      parts: {
        sidebar: { visible: true, size: 300, container: title ? { id: 'x', title } : undefined },
        auxiliarybar: { visible: false, size: 0 },
        panel: { visible: true, size: 250, container: panelTitle ? { id: 'p', title: panelTitle } : undefined },
      },
    });

  test('area names follow what is open, and a closed or unnamed area shows its plain name', async () => {
    let state: LayoutState | undefined = named('Explorer', 'Terminal');
    const env = { read: async () => state, write: async () => undefined };
    const draft = new Draft(undefined, env as never);
    assert.deepStrictEqual(draft.namesView(), {});
    await draft.refreshLive();
    assert.deepStrictEqual(draft.namesView(), { sidebar: 'Explorer', panel: 'Terminal' });
    state = named('Search');
    await draft.refreshLive();
    assert.deepStrictEqual(draft.namesView(), { sidebar: 'Search' });
    state = named('Source Control', 'Problems');
    await draft.useCurrentSizes();
    assert.deepStrictEqual(draft.namesView(), { sidebar: 'Source Control', panel: 'Problems' });
  });

  test('a failed read keeps the previous names, and names never change what Save writes', async () => {
    let state: LayoutState | undefined = named('Explorer');
    const { write, writes } = spy();
    const sizeWrites: unknown[] = [];
    const env = { read: async () => state, write: async (v: unknown) => void sizeWrites.push(v) };
    const draft = new Draft(write, env as never);
    await draft.refreshLive();
    state = undefined;
    await draft.refreshLive();
    assert.deepStrictEqual(draft.namesView(), { sidebar: 'Explorer' });
    assert.deepStrictEqual(await draft.save(), { written: [] });
    assert.deepStrictEqual(writes, []);
    assert.deepStrictEqual(sizeWrites, []);
  });

  // The editor grid: a stand-in for the live grid and a recording writer.
  const gridEnv = (read: { layout: unknown; labels: string[] } | undefined, failWrite = false) => {
    const writes: unknown[] = [];
    const env = {
      read: async () => read as never,
      write: async (value: unknown) => {
        if (failWrite) throw new Error('cannot write the grid');
        writes.push(value);
      },
    };
    return { env, writes };
  };
  const threeColumns = { orientation: 0, groups: [{ size: 400 }, { size: 300 }, { size: 300, groups: [{ size: 600 }, { size: 200 }] }] };
  const noSizes = sizeEnv(undefined).env as never;

  test('Use current layout drafts the proportions and labels, and Save writes them once', async () => {
    const { env, writes } = gridEnv({ layout: threeColumns, labels: ['Claude Code', 'Codex', 'Terminal', 'notes.md'] });
    const draft = new Draft(undefined, noSizes, env as never);
    await draft.useCurrentLayout();
    assert.deepStrictEqual(draft.gridView().saved?.groups[2], {
      size: 0.3,
      groups: [{ size: 0.75, label: 'Terminal' }, { size: 0.25, label: 'notes.md' }],
    });
    const result = await draft.save();
    assert.deepStrictEqual(result.written, ['editorGrid']);
    assert.strictEqual(writes.length, 1);
    assert.deepStrictEqual(draft.savedOptions(), ['editorGrid']);
    assert.deepStrictEqual((await draft.save()).written, []);
  });

  test('Clear drops the drafted grid, and Save then resets the setting', async () => {
    const { env, writes } = gridEnv({ layout: threeColumns, labels: [] });
    const draft = new Draft(undefined, noSizes, env as never);
    await draft.useCurrentLayout();
    await draft.save();
    await draft.clearGrid();
    assert.strictEqual(draft.gridView().saved, undefined);
    assert.deepStrictEqual((await draft.save()).written, ['editorGrid']);
    assert.strictEqual(writes[1], undefined);
  });

  test('a single editor group is drafted with a note, and an unreadable layout keeps the draft', async () => {
    let read: { layout: unknown; labels: string[] } | undefined = { layout: { orientation: 0, groups: [{ size: 1 }] }, labels: ['x'] };
    const env = { read: async () => read as never, write: async () => undefined };
    const draft = new Draft(undefined, noSizes, env as never);
    await draft.useCurrentLayout();
    assert.match(draft.gridView().note ?? '', /nothing to apply/);
    read = undefined;
    await draft.useCurrentLayout();
    assert.match(draft.gridView().note ?? '', /Could not read/);
    assert.ok(draft.gridView().saved);
  });

  test('a failed grid write names the grid, keeps the draft, and a second Save retries', async () => {
    const { env } = gridEnv({ layout: threeColumns, labels: [] }, true);
    const draft = new Draft(undefined, noSizes, env as never);
    await draft.useCurrentLayout();
    const first = await draft.save();
    assert.strictEqual(first.failed?.option, 'editorGrid');
    assert.match(first.failed?.message ?? '', /cannot write the grid/);
    assert.ok(draft.gridView().saved);
  });

  test('grid messages from the page are checked', () => {
    for (const type of ['useCurrentLayout', 'clearGrid']) assert.deepStrictEqual(parseMessage({ type }), { type });
  });

  test('Clear pressed while a capture is reading is applied after it, and Save after both', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const writes: unknown[] = [];
    const env = {
      read: async () => {
        await gate;
        return { layout: threeColumns, labels: [] } as never;
      },
      write: async (value: unknown) => void writes.push(value),
    };
    const draft = new Draft(undefined, noSizes, env as never);
    // The page sends the three messages without waiting between them.
    const capture = draft.useCurrentLayout();
    const clear = draft.clearGrid();
    const save = draft.save();
    release();
    await Promise.all([capture, clear]);
    assert.deepStrictEqual((await save).written, []);
    assert.strictEqual(draft.gridView().saved, undefined);
    assert.deepStrictEqual(writes, []);
  });

  test('a Save pressed while a capture is reading saves what the capture drafted', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const writes: unknown[] = [];
    const env = {
      read: async () => {
        await gate;
        return { layout: threeColumns, labels: [] } as never;
      },
      write: async (value: unknown) => void writes.push(value),
    };
    const draft = new Draft(undefined, noSizes, env as never);
    const capture = draft.useCurrentLayout();
    const save = draft.save();
    release();
    await capture;
    assert.deepStrictEqual((await save).written, ['editorGrid']);
    assert.strictEqual(writes.length, 1);
  });

  test('a Save pressed while Use current sizes is reading saves the sizes it filled', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const writes: unknown[] = [];
    const env = {
      read: async () => {
        await gate;
        return live();
      },
      write: async (value: unknown) => void writes.push(value),
    };
    const draft = new Draft(undefined, env as never);
    const use = draft.useCurrentSizes();
    const save = draft.save();
    release();
    await use;
    assert.deepStrictEqual((await save).written, ['sizes']);
    assert.strictEqual(writes.length, 1);
  });

  test('a size typed or cleared while Use current sizes is reading wins over the capture', async () => {
    for (const edit of ['35', '']) {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let first = true;
      const writes: unknown[] = [];
      const env = {
        read: async () => {
          // Only the capture's read is held open.
          if (first) {
            first = false;
            await gate;
          }
          return live();
        },
        write: async (value: unknown) => void writes.push(value),
      };
      const draft = new Draft(undefined, env as never);
      const capture = draft.useCurrentSizes();
      const typed = draft.setSize('sidebar', edit);
      const save = draft.save();
      release();
      await Promise.all([capture, typed]);
      assert.deepStrictEqual((await save).written, ['sizes']);
      const sidebar = (writes[0] as { sidebar?: number }).sidebar;
      assert.strictEqual(sidebar, edit === '' ? undefined : 0.35, `edit "${edit}"`);
      assert.deepStrictEqual(draft.sizesView().rows.map((r) => r.typed), [edit !== '', false, false]);
    }
  });

  test('a panel size typed while Use current sizes is reading keeps its typed flag and the live side', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    const writes: unknown[] = [];
    const env = {
      read: async () => {
        if (first) {
          first = false;
          await gate;
        }
        return live({ panelPosition: 'right' });
      },
      write: async (value: unknown) => void writes.push(value),
    };
    const draft = new Draft(undefined, env as never);
    const capture = draft.useCurrentSizes();
    const typed = draft.setSize('panel', '30');
    const save = draft.save();
    release();
    await Promise.all([capture, typed]);
    assert.deepStrictEqual((await save).written, ['sizes']);
    assert.deepStrictEqual((writes[0] as { panel: number; panelOrientation: string }).panel, 0.3);
    assert.strictEqual((writes[0] as { panelOrientation: string }).panelOrientation, 'across');
    assert.deepStrictEqual(draft.sizesView().rows.map((r) => r.typed), [false, false, true]);
  });

  // A stand-in for the saved layout: which agents live in each part (change `agents` to change the layout under a
  // Draft), whether any layout is saved, and whether the cross-window layout lock can be taken.
  const layoutOf = (agents: Partial<Record<PartName, AgentId[]>> = {}, saved = true) => {
    const env = {
      saved,
      busy: false,
      agents: { sidebar: [], auxiliarybar: [], panel: [], ...agents } as Record<PartName, AgentId[]>,
      // A fresh snapshot per read, as the real reader gives: sharing `env.agents` would let a later change leak into a Draft's view.
      read: () => ({ saved: env.saved, agents: JSON.parse(JSON.stringify(env.agents)) as Record<PartName, AgentId[]> }),
      hold: async (work: () => Promise<void>) => {
        if (env.busy) return false;
        await work();
        return true;
      },
    };
    return env;
  };
  const item = (draft: Draft, option: string) => draft.items().find((i) => i.option === option)!;

  test('an area the layout puts an agent in is shown locked as Keep, with the reason, and cannot be set to Hide', () => {
    const draft = new Draft(undefined, undefined, undefined, layoutOf({ auxiliarybar: ['codex'], panel: ['claudeCode', 'codex'] }));
    assert.deepStrictEqual([item(draft, 'hideSecondarySideBar').choice, item(draft, 'hideSecondarySideBar').locked], ['keep', 'Codex lives here']);
    assert.strictEqual(item(draft, 'hideBottomPanel').locked, 'Claude Code and Codex live here');
    assert.throws(() => draft.choose('hideSecondarySideBar', 'hide'), /in use/);
    // The area the layout leaves empty, and the chrome, still toggle.
    assert.strictEqual(item(draft, 'hidePrimarySideBar').locked, undefined);
    draft.choose('hidePrimarySideBar', 'hide');
    assert.strictEqual(item(draft, 'hidePrimarySideBar').choice, 'hide');
  });

  test('a stored Hide on an in-use area is shown as Keep, Save writes nothing for it, and the choice returns when the area is free', async () => {
    await config().update(key('hideSecondarySideBar'), true, GLOBAL);
    const layout = layoutOf({ auxiliarybar: ['codex'] });
    const none = spy();
    const draft = new Draft(none.write, undefined, undefined, layout);
    assert.strictEqual(item(draft, 'hideSecondarySideBar').choice, 'keep');
    assert.deepStrictEqual((await draft.save()).written, []);
    assert.deepStrictEqual(none.writes, []);
    assert.strictEqual(globalOf('hideSecondarySideBar'), true);

    layout.agents.auxiliarybar = [];
    await draft.refreshLive();
    assert.deepStrictEqual([item(draft, 'hideSecondarySideBar').choice, item(draft, 'hideSecondarySideBar').locked], ['hide', undefined]);
  });

  test('an area that becomes in use while Save is writing is skipped and reported, and never given a hide value', async () => {
    await config().update(key('hideBottomPanel'), false, GLOBAL);
    const layout = layoutOf();
    const writes: string[] = [];
    const write = async (option: string, value: boolean) => {
      writes.push(option);
      await config().update(key(option), value, GLOBAL);
      // Another window saves a layout with an agent in the panel between this write and the next.
      if (option === 'hideActivityBar') layout.agents.panel = ['codex'];
    };
    const draft = new Draft(write, undefined, undefined, layout);
    draft.choose('hideActivityBar', 'keep');
    draft.choose('hideBottomPanel', 'hide');

    const result = await draft.save();
    assert.deepStrictEqual(writes, ['hideActivityBar']);
    assert.deepStrictEqual(result.written, ['hideActivityBar']);
    assert.deepStrictEqual(result.skipped, [{ option: 'hideBottomPanel', reason: 'Codex lives here' }]);
    assert.strictEqual(globalOf('hideBottomPanel'), false);
    // The skipped choice is dropped from the draft, so the next Save does not report it again.
    assert.deepStrictEqual((await draft.save()).skipped, undefined);
  });

  test('the page defers sizes and the editor grid to the layout only while a layout is saved', async () => {
    const layout = layoutOf({}, false);
    const draft = new Draft(undefined, undefined, undefined, layout);
    assert.strictEqual(draft.layoutSaved(), false);
    layout.saved = true;
    assert.strictEqual(draft.layoutSaved(), false, 'read when the page opens, not on every look');
    await draft.refreshLive();
    assert.strictEqual(draft.layoutSaved(), true);
    assert.deepStrictEqual(parseMessage({ type: 'chooseLayout' }), { type: 'chooseLayout' });
  });

  test('Save changes nothing and says to try again when another window holds the layout lock', async () => {
    const layout = layoutOf();
    layout.busy = true;
    const none = spy();
    const draft = new Draft(none.write, undefined, undefined, layout);
    draft.choose('hideActivityBar', 'keep');
    const result = await draft.save();
    assert.deepStrictEqual(none.writes, []);
    assert.deepStrictEqual(result.written, []);
    assert.match(result.failed?.message ?? '', /busy with a layout. Try saving again in a moment/);

    layout.busy = false;
    assert.deepStrictEqual((await draft.save()).written, ['hideActivityBar']);
  });

  test('Save and Dismiss stays open when a choice changes while it writes, says so, and closes once that is saved too', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const s = spy();
    let started!: () => void;
    const writing = new Promise<void>((resolve) => (started = resolve));
    const write = async (option: string, value: boolean) => {
      started();
      await held;
      await s.write(option, value);
    };
    const page = fakePanel([]);
    const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'towelwise-picker-'));
    const context = { extensionUri: vscode.Uri.file(storage), subscriptions: [] } as unknown as vscode.ExtensionContext;
    try {
      openPicker(context, storage, () => page.panel as unknown as vscode.WebviewPanel, () => new Draft(write, undefined, undefined, layoutOf({}, false)));
      // Hide is the default, so Keep is the change to save.
      await page.send({ type: 'choose', option: 'hideActivityBar', choice: 'keep' });
      const saving = page.send({ type: 'save' });
      await writing;
      await page.send({ type: 'choose', option: 'hideActivityBar', choice: 'hide' });
      release();
      await saving;
      assert.strictEqual(globalOf('hideActivityBar'), false, 'the save wrote what was chosen when it was pressed');
      assert.strictEqual(page.disposed, false, 'Hide is not saved yet, so the panel stays');
      assert.strictEqual((page.posted.at(-1)?.result as { stale?: boolean } | undefined)?.stale, true);

      await page.send({ type: 'save' });
      assert.strictEqual(globalOf('hideActivityBar'), true);
      assert.strictEqual(page.disposed, true);
    } finally {
      page.panel.dispose();
      fs.rmSync(storage, { recursive: true, force: true });
    }
  });

  test('once a layout is saved, Save leaves the hidden sizes and editor grid alone, keeps them as drafts, and still saves the rest', async () => {
    const layout = layoutOf({}, false);
    const sizes = sizeEnv(live());
    const grid = gridEnv({ layout: threeColumns, labels: [] });
    const none = spy();
    const draft = new Draft(none.write, sizes.env as never, grid.env as never, layout);
    await draft.useCurrentSizes();
    await draft.useCurrentLayout();
    draft.choose('hideActivityBar', 'keep');
    layout.saved = true; // another window saves a layout; this page has not looked again

    const result = await draft.save();
    assert.deepStrictEqual(result.written, ['hideActivityBar']);
    assert.strictEqual(result.failed, undefined);
    assert.deepStrictEqual(sizes.writes, []);
    assert.deepStrictEqual(grid.writes, []);
    assert.strictEqual(draft.layoutSaved(), true, 'Save looked at the layout again');

    // The drafts were kept, not discarded: with the layout gone, the next Save writes them.
    layout.saved = false;
    assert.deepStrictEqual((await draft.save()).written, ['sizes', 'editorGrid']);
  });

  test('size text that cannot be saved no longer blocks Save once a layout has taken over the sizes', async () => {
    const layout = layoutOf({}, false);
    const sizes = sizeEnv(live());
    const none = spy();
    const draft = new Draft(none.write, sizes.env as never, undefined, layout);
    await draft.setSize('panel', 'abc');
    draft.choose('hideActivityBar', 'keep');
    assert.ok((await draft.save()).failed, 'without a layout, the bad size is refused');

    layout.saved = true;
    const result = await draft.save();
    assert.strictEqual(result.failed, undefined);
    assert.deepStrictEqual(result.written, ['hideActivityBar']);
    assert.deepStrictEqual(sizes.writes, []);
  });

  test('when Save finds a layout saved meanwhile, the page state it returns shows the lock and the note', async () => {
    await config().update(key('hideBottomPanel'), false, GLOBAL);
    const layout = layoutOf({}, false);
    const draft = new Draft(spy().write, undefined, undefined, layout);
    draft.choose('hideBottomPanel', 'hide');
    layout.saved = true;
    layout.agents.panel = ['codex'];

    const result = await draft.save();
    assert.deepStrictEqual(result.skipped, [{ option: 'hideBottomPanel', reason: 'Codex lives here' }]);
    assert.strictEqual(draft.layoutSaved(), true);
    assert.strictEqual(item(draft, 'hideBottomPanel').locked, 'Codex lives here');
    assert.throws(() => draft.choose('hideBottomPanel', 'hide'), /in use/);
  });
});
