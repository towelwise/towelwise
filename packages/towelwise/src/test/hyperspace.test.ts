import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { isActive, restore, stateFile, toggle } from '../hyperspace';
import { failReadOf } from './readFailure';

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
    await config().update('towelwise.hyperspace.editorGrid', undefined, vscode.ConfigurationTarget.Global);
    for (const key of ['hidePrimarySideBar', 'hideSecondarySideBar', 'hideBottomPanel']) {
      await config().update(`towelwise.hyperspace.${key}`, undefined, vscode.ConfigurationTarget.Global);
    }
    for (const key of ['towelwise.layout.agents', 'towelwise.layout.sizes', 'towelwise.layout.grid', 'workbench.sideBar.location']) {
      await config().update(key, undefined, vscode.ConfigurationTarget.Global);
    }
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

  test('a state file that cannot be read for a moment is kept, so a later restore still puts the settings back', async () => {
    const before = globalValues();
    await toggle(storageDir);
    assert.strictEqual(isActive(storageDir), true);

    const failing = failReadOf(stateFile(storageDir));
    try {
      await assert.rejects(toggle(storageDir), /could not be read/);
    } finally {
      failing.restore();
    }
    assert.strictEqual(isActive(storageDir), true, 'the only copy of the original settings is still there');
    assert.strictEqual(config().get(ACTIVITY_BAR), 'hidden', 'and nothing was changed');

    await toggle(storageDir);
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

  // A window whose main window comes to the front, or does not; the full screen and grid commands act on whichever is in front.
  const behindWindow = (windowId: string, comesForward: boolean) => {
    const win = fakeWindow(windowId);
    return { ...win, focusMain: async () => (win.ran.push('focus main'), comesForward) };
  };

  test('the main window comes to the front before full screen, on the jump and on the way back', async () => {
    await enableFullScreen();
    const win = behindWindow('a', true);
    await toggle(storageDir, win);
    assert.deepStrictEqual(win.ran.filter((c) => c === 'focus main' || c === TOGGLE_FULL_SCREEN), ['focus main', TOGGLE_FULL_SCREEN]);
    win.ran.length = 0;
    await toggle(storageDir, win);
    assert.deepStrictEqual(win.ran.filter((c) => c === 'focus main' || c === TOGGLE_FULL_SCREEN), ['focus main', TOGGLE_FULL_SCREEN]);
  });

  test('when the main window cannot come to the front, neither the jump nor the restore changes anything', async () => {
    await enableFullScreen();
    const before = globalValues();
    const stuck = behindWindow('a', false);
    await assert.rejects(toggle(storageDir, stuck), /main window/);
    assert.deepStrictEqual(stuck.ran, ['focus main']);
    assert.strictEqual(isActive(storageDir), false);
    assert.deepStrictEqual(globalValues(), before);

    await toggle(storageDir, behindWindow('a', true));
    const hidden = globalValues();
    stuck.ran.length = 0;
    await assert.rejects(toggle(storageDir, stuck), /main window/);
    await assert.rejects(restore(storageDir, stuck), /main window/);
    assert.deepStrictEqual(stuck.ran, ['focus main', 'focus main']);
    assert.strictEqual(isActive(storageDir), true, 'the saved copy stays, so the next press restores');
    assert.deepStrictEqual(globalValues(), hidden);
    await toggle(storageDir, behindWindow('a', true));
    assert.deepStrictEqual(globalValues(), before);
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

  // A stand-in for the editor area's grid: the layout it reports, what was applied, and optional failures.
  const GRID = 'towelwise.hyperspace.editorGrid';
  const columns = (...sizes: number[]) => ({ orientation: 0, groups: sizes.map((size) => ({ size })) });
  const savedColumns = (...sizes: number[]) => columns(...sizes);
  const gridWindow = (windowId: string, live: unknown, opts: { failRead?: boolean; failApply?: boolean; adjusted?: unknown } = {}) => {
    const base = sizedWindow(windowId);
    const applied: unknown[] = [];
    const order: string[] = [];
    const setSize = base.bridge.setSize;
    base.bridge.setSize = async (part: string, pixels: number) => {
      order.push(`size:${part}`);
      return setSize(part, pixels);
    };
    const win = {
      ...base,
      applied,
      order,
      live,
      grid: {
        read: async () => {
          if (opts.failRead) throw new Error('read failed');
          return win.live;
        },
        apply: async (layout: unknown) => {
          order.push('grid');
          if (opts.failApply) throw new Error('apply failed');
          applied.push(layout);
          // The grid ends up as asked, unless the test says VS Code adjusted it.
          win.live = opts.adjusted ?? layout;
        },
      },
    };
    return win;
  };
  const saveGrid = (value: unknown) => config().update(GRID, value, vscode.ConfigurationTarget.Global);

  test('a jump applies the saved proportions after the side bar sizes, and leaving puts the old ones back', async () => {
    await saveSizes({ sidebar: 0.1 });
    await saveGrid(savedColumns(0.25, 0.25, 0.5));
    const win = gridWindow('a', columns(500, 300, 200));
    await toggle(storageDir, win);
    assert.deepStrictEqual(win.applied, [columns(0.25, 0.25, 0.5)]);
    assert.deepStrictEqual(win.order, ['size:sidebar', 'grid']);
    win.applied.length = 0;
    await toggle(storageDir, win);
    assert.deepStrictEqual(win.applied, [columns(500, 300, 200)]);
  });

  test('a different shape is left alone on a jump, with one message', async () => {
    await saveGrid(savedColumns(0.5, 0.5));
    const win = gridWindow('a', columns(500, 300, 200));
    await toggle(storageDir, win);
    assert.deepStrictEqual(win.applied, []);
    assert.strictEqual(win.told.length, 1);
    await toggle(storageDir, win);
    // Leaving still restores the grid it recorded, which has not changed.
    assert.deepStrictEqual(win.applied, [columns(500, 300, 200)]);
  });

  test('restore leaves the grid alone when its shape changed meanwhile, or in another window', async () => {
    await saveGrid(savedColumns(0.5, 0.5));
    const win = gridWindow('a', columns(500, 500));
    await toggle(storageDir, win);
    win.applied.length = 0;
    win.live = columns(300, 300, 400);
    await toggle(storageDir, win);
    assert.deepStrictEqual(win.applied, []);

    const a = gridWindow('a', columns(500, 500));
    const b = gridWindow('b', columns(500, 500));
    await toggle(storageDir, a);
    a.applied.length = 0;
    await toggle(storageDir, b);
    assert.deepStrictEqual(b.applied, []);
    assert.strictEqual(isActive(storageDir), false);
  });

  test('with no saved grid nothing is applied on a jump, but restore still puts a changed grid back', async () => {
    const win = gridWindow('a', columns(500, 500));
    await toggle(storageDir, win);
    assert.deepStrictEqual(win.applied, []);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(stateFile(storageDir), 'utf8')).grid, columns(500, 500));
    await toggle(storageDir, win);
    assert.deepStrictEqual(win.applied, [columns(500, 500)]);
  });

  test('a saved grid of one group applies nothing', async () => {
    await saveGrid({ orientation: 0, groups: [{ size: 1 }] });
    const win = gridWindow('a', columns(1));
    await toggle(storageDir, win);
    assert.deepStrictEqual(win.applied, []);
    assert.strictEqual(win.told.length, 0);
    await toggle(storageDir, win);
  });

  test('a grid that fails to read or apply is logged and never stops a jump or a restore', async () => {
    await saveGrid(savedColumns(0.5, 0.5));
    const before = globalValues();
    const unreadable = gridWindow('a', columns(500, 500), { failRead: true });
    await toggle(storageDir, unreadable);
    assert.strictEqual(JSON.parse(fs.readFileSync(stateFile(storageDir), 'utf8')).grid, undefined);
    await toggle(storageDir, unreadable);
    assert.deepStrictEqual(globalValues(), before);

    const failing = gridWindow('a', columns(500, 500), { failApply: true });
    await toggle(storageDir, failing);
    assert.ok(failing.logs.some((l) => /could not apply/.test(l)));
    await toggle(storageDir, failing);
    assert.strictEqual(isActive(storageDir), false);
    assert.deepStrictEqual(globalValues(), before);
  });

  test('a hand-edited grid that does not fit is ignored on a jump', async () => {
    await saveGrid({ orientation: 0, groups: [{ size: 'wide' }] });
    const win = gridWindow('a', columns(500, 500));
    await toggle(storageDir, win);
    assert.deepStrictEqual(win.applied, []);
    assert.ok(win.logs.some((l) => /ignored editorGrid/.test(l)));
    await toggle(storageDir, win);
  });

  test('a valid snapshot with bad grid data restores its settings and skips the grid', async () => {
    await config().update(STATUS_BAR, false, vscode.ConfigurationTarget.Global);
    fs.writeFileSync(
      stateFile(storageDir),
      JSON.stringify({ settings: [{ key: STATUS_BAR, had: true, value: true }], fullScreen: false, windowId: 'a', grid: { orientation: 5 } }),
    );
    const win = gridWindow('a', columns(500, 500));
    await toggle(storageDir, win);
    assert.strictEqual(config().inspect(STATUS_BAR)?.globalValue, true);
    assert.deepStrictEqual(win.applied, []);
    assert.strictEqual(isActive(storageDir), false);
  });

  test('an applied grid that VS Code adjusted is logged, and one that came out as asked is not', async () => {
    await saveGrid(savedColumns(0.25, 0.25, 0.5));
    const exact = gridWindow('a', columns(500, 300, 200));
    await toggle(storageDir, exact);
    assert.ok(exact.logs.includes('editor grid: proportions applied'));
    await toggle(storageDir, exact);

    const adjusted = gridWindow('a', columns(500, 300, 200), { adjusted: columns(0.4, 0.1, 0.5) });
    await toggle(storageDir, adjusted);
    assert.ok(adjusted.logs.some((l) => /adjusted by up to 15%/.test(l)));
    await toggle(storageDir, adjusted);
    assert.strictEqual(isActive(storageDir), false);
  });

  // The saved layout (Choose Layout) says which areas hold an agent; hyperspace never hides those.
  const CLOSE_SIDEBAR = 'workbench.action.closeSidebar';
  const CLOSE_AUXILIARY = 'workbench.action.closeAuxiliaryBar';
  const CLOSE_PANEL = 'workbench.action.closePanel';
  const setting = (key: string, value: unknown) => config().update(key, value, vscode.ConfigurationTarget.Global);
  const hideAllAreas = async () => {
    await setting('towelwise.hyperspace.hidePrimarySideBar', true);
    await setting('towelwise.hyperspace.hideSecondarySideBar', true);
    await setting('towelwise.hyperspace.hideBottomPanel', true);
  };

  test('a jump keeps the area a saved agent lives in, whatever its hide setting says, and leaves that setting alone', async () => {
    await hideAllAreas();
    await setting('towelwise.layout.agents', { codex: 'right' });
    const win = fakeWindow('a');
    await toggle(storageDir, win);
    assert.deepStrictEqual(win.ran, [CLOSE_SIDEBAR, CLOSE_PANEL]);
    assert.strictEqual(config().get('towelwise.hyperspace.hideSecondarySideBar'), true);
    await toggle(storageDir, win);
  });

  test('"right" is the primary side bar when the side bar is on the right, and an agent on the panel keeps the panel', async () => {
    await hideAllAreas();
    await setting('workbench.sideBar.location', 'right');
    await setting('towelwise.layout.agents', { codex: 'right', claudeCode: 'panel' });
    const win = fakeWindow('a');
    await toggle(storageDir, win);
    assert.deepStrictEqual(win.ran, [CLOSE_AUXILIARY]);
    await toggle(storageDir, win);
  });

  // With a saved layout, its sizes and grid are the only ones: hyperspace has none of its own then.
  const layoutColumns = (...sizes: number[]) => ({ orientation: 0, groups: sizes.map((size) => ({ size, holds: 'terminal' })) });
  const ignoredNote = (logs: string[]) => logs.filter((l) => /a layout is saved/.test(l));

  test('a jump sizes the parts with the layout\'s sizes, ignores the hyperspace sizes, and says so once', async () => {
    await saveSizes({ sidebar: 0.5, auxiliarybar: 0.5 });
    await setting('towelwise.layout.agents', { codex: 'right' });
    await setting('towelwise.layout.sizes', { sidebar: 0.1, auxiliarybar: 0.25 });
    const win = sizedWindow('a');
    await toggle(storageDir, win);
    assert.deepStrictEqual(win.sets, [['sidebar', 200], ['auxiliarybar', 500]]);
    assert.strictEqual(ignoredNote(win.logs).length, 1);
    win.sets.length = 0;
    await toggle(storageDir, win);
    assert.deepStrictEqual(win.sets, [['sidebar', 300], ['auxiliarybar', 400], ['panel', 250]]);
  });

  test('a saved layout without sizes still takes over: the hyperspace sizes are not applied', async () => {
    await saveSizes({ sidebar: 0.5 });
    await setting('towelwise.layout.agents', { codex: 'right' });
    const win = sizedWindow('a');
    await toggle(storageDir, win);
    assert.deepStrictEqual(win.sets, []);
    await toggle(storageDir, win);
  });

  test('a jump applies the layout\'s grid proportions after the sizes, ignores the hyperspace grid, and restore puts the old grid back', async () => {
    await saveGrid(savedColumns(0.1, 0.1, 0.8));
    await setting('towelwise.layout.sizes', { sidebar: 0.1 });
    await setting('towelwise.layout.grid', layoutColumns(0.25, 0.25, 0.5));
    const win = gridWindow('a', columns(500, 300, 200));
    await toggle(storageDir, win);
    assert.deepStrictEqual(win.applied, [columns(0.25, 0.25, 0.5)]);
    assert.deepStrictEqual(win.order, ['size:sidebar', 'grid']);
    win.applied.length = 0;
    await toggle(storageDir, win);
    assert.deepStrictEqual(win.applied, [columns(500, 300, 200)]);
  });

  test('a layout grid whose columns and rows no longer match the window is left alone, and the person is told', async () => {
    await setting('towelwise.layout.grid', layoutColumns(0.25, 0.25, 0.5));
    const win = gridWindow('a', columns(500, 500));
    await toggle(storageDir, win);
    assert.deepStrictEqual(win.applied, []);
    assert.strictEqual(win.told.length, 1);
    await toggle(storageDir, win);
  });

  test('the real host records and sets the main window grid, with the main window in front, whichever window is active', async () => {
    const calls: string[] = [];
    const fakes = [
      vscode.commands.registerCommand('_towelwise.layout.mainLayout', () => (calls.push('read'), columns(500, 500))),
      vscode.commands.registerCommand('_towelwise.layout.focusMain', () => (calls.push('focus'), true)),
    ];
    try {
      await saveGrid(savedColumns(0.25, 0.75));
      await toggle(storageDir);
      const recorded = JSON.parse(fs.readFileSync(stateFile(storageDir), 'utf8'));
      assert.deepStrictEqual(recorded.grid, columns(500, 500), 'the main window grid is recorded, not the active window one');
      assert.strictEqual(calls[0], 'focus', 'the main window comes forward before anything is read or set');
      await toggle(storageDir);
    } finally {
      fakes.forEach((f) => f.dispose());
      await vscode.commands.executeCommand('workbench.action.editorLayoutSingle');
    }
  });

  test('a layout with no agents in the side areas, or no layout at all, hides every area the settings say', async () => {
    await hideAllAreas();
    await setting('towelwise.layout.agents', { codex: 'column' });
    const column = fakeWindow('a');
    await toggle(storageDir, column);
    assert.deepStrictEqual(column.ran, [CLOSE_SIDEBAR, CLOSE_AUXILIARY, CLOSE_PANEL]);
    await toggle(storageDir, column);

    await setting('towelwise.layout.agents', undefined);
    const none = fakeWindow('a');
    await toggle(storageDir, none);
    assert.deepStrictEqual(none.ran, [CLOSE_SIDEBAR, CLOSE_AUXILIARY, CLOSE_PANEL]);
    await toggle(storageDir, none);
  });
});
