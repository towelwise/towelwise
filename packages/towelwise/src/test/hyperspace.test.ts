import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { toggle } from '../hyperspace';

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
});
