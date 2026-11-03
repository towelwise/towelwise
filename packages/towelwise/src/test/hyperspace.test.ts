import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { isActive, restore, stateFile, toggle } from '../hyperspace';

const ACTIVITY_BAR = 'workbench.activityBar.location';
const STATUS_BAR = 'workbench.statusBar.visible';
const MENU_BAR = 'window.menuBarVisibility';
const COMMAND_CENTER = 'window.commandCenter';
const LAYOUT_CONTROL = 'workbench.layoutControl.enabled';
const FULL_SCREEN = 'towelwise.hyperspace.fullScreen';
const HIDE_COMMAND_CENTER = 'towelwise.hyperspace.hideCommandCenter';
const HIDE_LAYOUT_CONTROLS = 'towelwise.hyperspace.hideLayoutControls';
const KEYS = [ACTIVITY_BAR, STATUS_BAR, MENU_BAR, COMMAND_CENTER, LAYOUT_CONTROL];

const config = () => vscode.workspace.getConfiguration();
const globalValues = () => KEYS.map((k) => config().inspect(k)?.globalValue);

suite('hyperspace', () => {
  let storageDir: string;
  let original: unknown[];

  setup(async () => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'towelwise-'));
    original = globalValues();
  });

  teardown(async () => {
    for (const [i, k] of KEYS.entries()) {
      await config().update(k, original[i], vscode.ConfigurationTarget.Global);
    }
    await config().update(STATUS_BAR, undefined, vscode.ConfigurationTarget.Workspace);
    await config().update(LAYOUT_CONTROL, undefined, vscode.ConfigurationTarget.Workspace);
    await config().update(FULL_SCREEN, undefined, vscode.ConfigurationTarget.Global);
    await config().update('towelwise.hyperspace.sizes', undefined, vscode.ConfigurationTarget.Global);
    await config().update('towelwise.hyperspace.hideBottomPanel', undefined, vscode.ConfigurationTarget.Global);
    await config().update(HIDE_COMMAND_CENTER, undefined, vscode.ConfigurationTarget.Global);
    await config().update(HIDE_LAYOUT_CONTROLS, undefined, vscode.ConfigurationTarget.Global);
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  test('jump hides the chrome and restore leaves unset settings unset', async () => {
    for (const k of KEYS) {
      await config().update(k, undefined, vscode.ConfigurationTarget.Global);
    }

    await toggle(storageDir);
    assert.strictEqual(config().get(ACTIVITY_BAR), 'hidden');
    assert.strictEqual(config().get(STATUS_BAR), false);
    assert.strictEqual(config().get(MENU_BAR), 'hidden');
    assert.strictEqual(config().get(COMMAND_CENTER), false);
    assert.strictEqual(config().get(LAYOUT_CONTROL), false);

    await toggle(storageDir);
    assert.deepStrictEqual(globalValues(), KEYS.map(() => undefined));
  });

  test('each new item can be left alone on its own', async () => {
    await config().update(HIDE_COMMAND_CENTER, false, vscode.ConfigurationTarget.Global);
    const before = globalValues();

    await toggle(storageDir);
    assert.strictEqual(config().inspect(COMMAND_CENTER)?.globalValue, before[3]);
    assert.strictEqual(config().get(LAYOUT_CONTROL), false);
    await toggle(storageDir);
    assert.deepStrictEqual(globalValues(), before);

    await config().update(HIDE_COMMAND_CENTER, undefined, vscode.ConfigurationTarget.Global);
    await config().update(HIDE_LAYOUT_CONTROLS, false, vscode.ConfigurationTarget.Global);
    await toggle(storageDir);
    assert.strictEqual(config().get(COMMAND_CENTER), false);
    assert.strictEqual(config().inspect(LAYOUT_CONTROL)?.globalValue, before[4]);
    await toggle(storageDir);
    assert.deepStrictEqual(globalValues(), before);
  });

  test('a workspace setting that keeps the layout buttons visible is reported and left alone', async () => {
    await config().update(LAYOUT_CONTROL, true, vscode.ConfigurationTarget.Workspace);

    const blocked = await toggle(storageDir);
    assert.deepStrictEqual(blocked, [LAYOUT_CONTROL]);
    assert.strictEqual(config().get(COMMAND_CENTER), false);
    assert.strictEqual(config().inspect(LAYOUT_CONTROL)?.workspaceValue, true);
  });
  test("restore puts back a value that was already set", async () => {
    await config().update(STATUS_BAR, true, vscode.ConfigurationTarget.Global);
    await config().update(MENU_BAR, "compact", vscode.ConfigurationTarget.Global);
    const before = globalValues();

    await toggle(storageDir);
    assert.strictEqual(config().get(STATUS_BAR), false);

    await toggle(storageDir);
    assert.deepStrictEqual(globalValues(), before);
  });

  test("a workspace setting that keeps a bar visible is reported and left alone", async () => {
    await config().update(STATUS_BAR, true, vscode.ConfigurationTarget.Workspace);
    const before = globalValues();

    const blocked = await toggle(storageDir);
    assert.deepStrictEqual(blocked, [STATUS_BAR]);
    assert.strictEqual(config().get(ACTIVITY_BAR), "hidden");
    assert.strictEqual(config().inspect(STATUS_BAR)?.workspaceValue, true);

    await toggle(storageDir);
    assert.deepStrictEqual(globalValues(), before);
    assert.strictEqual(config().inspect(STATUS_BAR)?.workspaceValue, true);
  });

  test('a toggle that overlaps a jump is ignored, so the snapshot survives', async () => {
    const before = globalValues();

    await Promise.all([toggle(storageDir), toggle(storageDir)]);
    assert.strictEqual(isActive(storageDir), true);
    assert.strictEqual(config().get(ACTIVITY_BAR), 'hidden');

    await toggle(storageDir);
    assert.strictEqual(isActive(storageDir), false);
    assert.deepStrictEqual(globalValues(), before);
  });

  test('an unreadable state file is cleared with an explanation, not left stuck', async () => {
    const before = globalValues();
    fs.writeFileSync(stateFile(storageDir), '');

    await assert.rejects(toggle(storageDir), /unreadable/);
    assert.strictEqual(isActive(storageDir), false);

    await toggle(storageDir);
    assert.strictEqual(config().get(ACTIVITY_BAR), 'hidden');
    await toggle(storageDir);
    assert.deepStrictEqual(globalValues(), before);
  });

  // A pid no process can have, standing in for a window that crashed mid-transition.
  const DEAD_PID = 0x7ffffffe;
  const plantLock = (name: string, pid: number) =>
    fs.writeFileSync(path.join(storageDir, `hyperspace.lock.${name}`), JSON.stringify({ pid, time: Date.now() }));

  test('restore works immediately after a crash left a fresh lock behind', async () => {
    const before = globalValues();
    await toggle(storageDir);
    plantLock('crashed', DEAD_PID);

    assert.strictEqual(await restore(storageDir), true);
    assert.strictEqual(isActive(storageDir), false);
    assert.deepStrictEqual(globalValues(), before);
  });

  test('competing toggles over an abandoned lock run exactly one transition', async () => {
    const before = globalValues();
    plantLock('crashed', DEAD_PID);

    await Promise.all([toggle(storageDir), toggle(storageDir)]);
    assert.strictEqual(isActive(storageDir), true);
    assert.strictEqual(config().get(ACTIVITY_BAR), 'hidden');

    await toggle(storageDir);
    assert.deepStrictEqual(globalValues(), before);
  });

  test('a live owner keeps its lock: restore reports busy and changes nothing', async () => {
    await toggle(storageDir);
    const hidden = globalValues();
    plantLock('other-window', process.ppid);

    assert.strictEqual(await restore(storageDir), false);
    assert.strictEqual(isActive(storageDir), true);
    assert.deepStrictEqual(globalValues(), hidden);
    assert.ok(fs.existsSync(path.join(storageDir, 'hyperspace.lock.other-window')));
  });

  // A stand-in for one VS Code window, so full screen can be observed without toggling the real test window.
  const TOGGLE_FULL_SCREEN = 'workbench.action.toggleFullScreen';
  const fakeWindow = (windowId: string, failOn?: string) => {
    const ran: string[] = [];
    return {
      windowId,
      ran,
      run: async (command: string) => {
        ran.push(command);
        if (command === failOn) throw new Error('command failed');
      },
    };
  };
  const savedFullScreen = () => JSON.parse(fs.readFileSync(stateFile(storageDir), 'utf8')).fullScreen;
  const enableFullScreen = () => config().update(FULL_SCREEN, true, vscode.ConfigurationTarget.Global);

  test('full screen is left alone unless its setting is on', async () => {
    const win = fakeWindow('a');
    await toggle(storageDir, win);
    assert.strictEqual(savedFullScreen(), false);
    await toggle(storageDir, win);
    assert.ok(!win.ran.includes(TOGGLE_FULL_SCREEN));
  });

  test('the window that jumped into full screen leaves it on restore', async () => {
    await enableFullScreen();
    const win = fakeWindow('a');
    await toggle(storageDir, win);
    assert.strictEqual(savedFullScreen(), true);
    await toggle(storageDir, win);
    assert.strictEqual(win.ran.filter((c) => c === TOGGLE_FULL_SCREEN).length, 2);
  });

  test('restoring from another window restores settings but leaves full screen alone', async () => {
    await enableFullScreen();
    const before = globalValues();
    const a = fakeWindow('a');
    const b = fakeWindow('b');
    await toggle(storageDir, a);
    await toggle(storageDir, b);
    assert.ok(!b.ran.includes(TOGGLE_FULL_SCREEN));
    assert.strictEqual(isActive(storageDir), false);
    assert.deepStrictEqual(globalValues(), before);
  });

  test('a jump that fails undoes itself, so the next press jumps and full screen is not toggled back', async () => {
    await enableFullScreen();
    const before = globalValues();
    for (const failOn of ['workbench.action.closePanel', TOGGLE_FULL_SCREEN]) {
      const failing = fakeWindow('a', failOn);
      await assert.rejects(toggle(storageDir, failing), /command failed/);
      assert.strictEqual(isActive(storageDir), false);
      assert.deepStrictEqual(globalValues(), before);
      // Only the attempt that failed: the undo never toggles full screen back.
      assert.strictEqual(failing.ran.filter((c) => c === TOGGLE_FULL_SCREEN).length, failOn === TOGGLE_FULL_SCREEN ? 1 : 0);

      const next = fakeWindow('a');
      await toggle(storageDir, next);
      assert.strictEqual(isActive(storageDir), true);
      assert.strictEqual(config().get(ACTIVITY_BAR), 'hidden');
      await toggle(storageDir, next);
      assert.deepStrictEqual(globalValues(), before);
    }
  });

  test('a snapshot saved by the previous version is still restored', async () => {
    await config().update(STATUS_BAR, false, vscode.ConfigurationTarget.Global);
    fs.writeFileSync(stateFile(storageDir), JSON.stringify([{ key: STATUS_BAR, had: true, value: true }]));

    await toggle(storageDir, fakeWindow('a'));
    assert.strictEqual(config().inspect(STATUS_BAR)?.globalValue, true);
    assert.strictEqual(isActive(storageDir), false);
  });

  test('an unexpected error reading another lock aborts and leaves no lock of ours behind', async () => {
    const before = globalValues();
    // A directory cannot be read as a file: a real read error that is not "file missing".
    fs.mkdirSync(path.join(storageDir, 'hyperspace.lock.unreadable'));

    await assert.rejects(toggle(storageDir));
    assert.deepStrictEqual(fs.readdirSync(storageDir), ['hyperspace.lock.unreadable']);
    assert.strictEqual(isActive(storageDir), false);
    assert.deepStrictEqual(globalValues(), before);
  });

  // A stand-in bridge: the layout it reports, the sizes set on it, and optional failures.
  const SIZES = 'towelwise.hyperspace.sizes';
  const layoutState = (over: Record<string, unknown> = {}) => ({
    window: { width: 2000, height: 1000 },
    panelPosition: 'bottom',
    parts: {
      sidebar: { visible: true, size: 300 },
      auxiliarybar: { visible: true, size: 400 },
      panel: { visible: true, size: 250 },
    },
    ...over,
  });
  const sizedWindow = (windowId: string, opts: { failRead?: boolean; failWrite?: string } = {}) => {
    const base = fakeWindow(windowId);
    const sets: [string, number][] = [];
    const logs: string[] = [];
    const told: string[] = [];
    const win = {
      ...base,
      sets,
      logs,
      told,
      state: layoutState() as unknown,
      log: (line: string) => logs.push(line),
      tell: (message: string) => told.push(message),
      bridge: {
        state: async () => {
          if (opts.failRead) throw new Error('read failed');
          return win.state as never;
        },
        setSize: async (part: string, pixels: number) => {
          if (part === opts.failWrite) throw new Error('write failed');
          sets.push([part, pixels]);
          return pixels as unknown;
        },
      },
    };
    return win;
  };
  const saveSizes = (value: unknown) => config().update(SIZES, value, vscode.ConfigurationTarget.Global);
  const keepPanel = () => config().update('towelwise.hyperspace.hideBottomPanel', false, vscode.ConfigurationTarget.Global);

  test('a jump sizes the parts it keeps and leaving puts the old pixel sizes back', async () => {
    await saveSizes({ sidebar: 0.1, auxiliarybar: 0.25, panel: 0.5, panelOrientation: 'down' });
    const win = sizedWindow('a');
    await toggle(storageDir, win);
    // The bottom panel is hidden by default, so only the side bars are sized.
    assert.deepStrictEqual(win.sets, [['sidebar', 200], ['auxiliarybar', 500]]);
    win.sets.length = 0;
    await toggle(storageDir, win);
    assert.deepStrictEqual(win.sets, [['sidebar', 300], ['auxiliarybar', 400], ['panel', 250]]);
  });

  test('a kept panel is sized too', async () => {
    await keepPanel();
    await saveSizes({ panel: 0.5, panelOrientation: 'down' });
    const win = sizedWindow('a');
    await toggle(storageDir, win);
    assert.deepStrictEqual(win.sets, [['panel', 500]]);
    await toggle(storageDir, win);
  });

  test('with no saved sizes nothing is sized on a jump, but the grid is recorded and put back on restore', async () => {
    const win = sizedWindow('a');
    await toggle(storageDir, win);
    assert.deepStrictEqual(win.sets, []);
    // The grid moved the remaining parts while areas closed.
    win.state = layoutState({ parts: { ...layoutState().parts, sidebar: { visible: true, size: 700 } } });
    await toggle(storageDir, win);
    assert.deepStrictEqual(win.sets, [['sidebar', 300], ['auxiliarybar', 400], ['panel', 250]]);
  });

  test('restoring from another window leaves sizes alone but restores settings', async () => {
    await saveSizes({ sidebar: 0.1 });
    const before = globalValues();
    const a = sizedWindow('a');
    const b = sizedWindow('b');
    await toggle(storageDir, a);
    await toggle(storageDir, b);
    assert.deepStrictEqual(b.sets, []);
    assert.deepStrictEqual(globalValues(), before);
    assert.strictEqual(isActive(storageDir), false);
  });

  test('restore skips parts that closed and a panel that turned, and tells the person', async () => {
    await keepPanel();
    await saveSizes({ sidebar: 0.1, panel: 0.5, panelOrientation: 'down' });
    const win = sizedWindow('a');
    await toggle(storageDir, win);
    win.sets.length = 0;
    win.state = layoutState({
      panelPosition: 'right',
      parts: { ...layoutState().parts, sidebar: { visible: false, size: 0 } },
    });
    await toggle(storageDir, win);
    // The side bar closed and the panel turned; only the auxiliary bar is still there to size.
    assert.deepStrictEqual(win.sets, [['auxiliarybar', 400]]);
    assert.strictEqual(win.told.length, 1);
  });

  test('a jump skips a panel on another side than it was saved for, and tells the person', async () => {
    await keepPanel();
    await saveSizes({ panel: 0.5, panelOrientation: 'across' });
    const win = sizedWindow('a');
    await toggle(storageDir, win);
    assert.deepStrictEqual(win.sets, []);
    assert.strictEqual(win.told.length, 1);
    await toggle(storageDir, win);
  });

  test('a grid that adjusts a size is logged, not a failure', async () => {
    await saveSizes({ sidebar: 0.1 });
    const win = sizedWindow('a');
    win.bridge.setSize = async () => 123;
    await toggle(storageDir, win);
    assert.ok(win.logs.some((l) => /asked for 200px, got 123px/.test(l)));
    await toggle(storageDir, win);
  });

  test('a bridge that fails to read gives a snapshot without sizes, and the jump still works', async () => {
    await saveSizes({ sidebar: 0.1 });
    const before = globalValues();
    const win = sizedWindow('a', { failRead: true });
    await toggle(storageDir, win);
    assert.strictEqual(isActive(storageDir), true);
    assert.strictEqual(JSON.parse(fs.readFileSync(stateFile(storageDir), 'utf8')).sizes, undefined);
    await toggle(storageDir, win);
    assert.deepStrictEqual(win.sets, []);
    assert.deepStrictEqual(globalValues(), before);
  });

  test('a bridge that fails to write is logged, the other parts are tried, and everything else completes', async () => {
    await saveSizes({ sidebar: 0.1, auxiliarybar: 0.25 });
    const before = globalValues();
    const win = sizedWindow('a', { failWrite: 'sidebar' });
    await toggle(storageDir, win);
    assert.deepStrictEqual(win.sets, [['auxiliarybar', 500]]);
    assert.ok(win.logs.some((l) => /could not set sidebar/.test(l)));
    win.sets.length = 0;
    await toggle(storageDir, win);
    assert.deepStrictEqual(win.sets, [['auxiliarybar', 400], ['panel', 250]]);
    assert.strictEqual(isActive(storageDir), false);
    assert.deepStrictEqual(globalValues(), before);
  });

  test('a valid snapshot with bad size data restores its settings and skips sizes', async () => {
    await config().update(STATUS_BAR, false, vscode.ConfigurationTarget.Global);
    fs.writeFileSync(
      stateFile(storageDir),
      JSON.stringify({ settings: [{ key: STATUS_BAR, had: true, value: true }], fullScreen: false, windowId: 'a', sizes: { pixels: { sidebar: 'wide' } } }),
    );
    const win = sizedWindow('a');
    await toggle(storageDir, win);
    assert.strictEqual(config().inspect(STATUS_BAR)?.globalValue, true);
    assert.deepStrictEqual(win.sets, []);
    assert.strictEqual(isActive(storageDir), false);
  });

  test('without a bridge, jumps work and nothing throws', async () => {
    await saveSizes({ sidebar: 0.1 });
    const before = globalValues();
    const win = { ...fakeWindow('a'), log: () => undefined };
    await toggle(storageDir, win);
    assert.strictEqual(isActive(storageDir), true);
    await toggle(storageDir, win);
    assert.deepStrictEqual(globalValues(), before);
  });
});
