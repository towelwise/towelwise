import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { isActive, restore, stateFile, toggle } from '../hyperspace';

const ACTIVITY_BAR = 'workbench.activityBar.location';
const STATUS_BAR = 'workbench.statusBar.visible';
const MENU_BAR = 'window.menuBarVisibility';
const KEYS = [ACTIVITY_BAR, STATUS_BAR, MENU_BAR];

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

    await toggle(storageDir);
    assert.deepStrictEqual(globalValues(), [undefined, undefined, undefined]);
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
});
