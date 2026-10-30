import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { stateFile } from '../hyperspace';
import { applyOnStartup, restoreLayout } from '../layout';

const CONTAINERS = 'towelwise.layout.containers';
const ON_STARTUP = 'towelwise.layout.applyOnStartup';
const GLOBAL = vscode.ConfigurationTarget.Global;
const config = () => vscode.workspace.getConfiguration();

// A stand-in for VS Code: which show commands exist, and a record of the ones that ran.
const fakeVsCode = (available: string[]) => {
  const ran: string[] = [];
  return { ran, available: new Set(available), run: async (command: string) => void ran.push(command) };
};

suite('layout', () => {
  let storageDir: string;

  setup(() => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'towelwise-layout-'));
  });

  teardown(async () => {
    await config().update(CONTAINERS, undefined, GLOBAL);
    await config().update(ON_STARTUP, undefined, GLOBAL);
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  test('restore shows each saved container, in saved order', async () => {
    await config().update(CONTAINERS, ['codex', 'antigravity'], GLOBAL);
    const vs = fakeVsCode(['workbench.view.extension.antigravity', 'workbench.view.extension.codex']);

    const result = await restoreLayout(vs);
    assert.deepStrictEqual(vs.ran, ['workbench.view.extension.codex', 'workbench.view.extension.antigravity']);
    assert.deepStrictEqual(result, { shown: ['codex', 'antigravity'], skipped: [] });
  });

  test('restore skips a container that is not available, reports it, and keeps the layout', async () => {
    await config().update(CONTAINERS, ['antigravity', 'gone', 'codex'], GLOBAL);
    const vs = fakeVsCode(['workbench.view.extension.antigravity', 'workbench.view.extension.codex']);

    const result = await restoreLayout(vs);
    assert.deepStrictEqual(vs.ran, ['workbench.view.extension.antigravity', 'workbench.view.extension.codex']);
    assert.deepStrictEqual(result, { shown: ['antigravity', 'codex'], skipped: ['gone'] });
    assert.deepStrictEqual(config().get(CONTAINERS), ['antigravity', 'gone', 'codex']);
  });

  test('built-in Chat is shown with its own command', async () => {
    await config().update(CONTAINERS, ['workbench.panel.chat'], GLOBAL);
    const vs = fakeVsCode(['workbench.action.chat.open']);

    await restoreLayout(vs);
    assert.deepStrictEqual(vs.ran, ['workbench.action.chat.open']);
  });

  test('an empty layout runs nothing', async () => {
    const vs = fakeVsCode(['workbench.view.extension.codex']);

    assert.deepStrictEqual(await restoreLayout(vs), { shown: [], skipped: [] });
    assert.deepStrictEqual(vs.ran, []);
  });

  test('startup apply runs only when its setting is on and hyperspace is off', async () => {
    await config().update(CONTAINERS, ['codex'], GLOBAL);
    const run = async () => {
      const vs = fakeVsCode(['workbench.view.extension.codex']);
      return { applied: await applyOnStartup(storageDir, vs), ran: vs.ran };
    };

    assert.deepStrictEqual(await run(), { applied: false, ran: [] });

    await config().update(ON_STARTUP, true, GLOBAL);
    assert.deepStrictEqual(await run(), { applied: true, ran: ['workbench.view.extension.codex'] });

    fs.writeFileSync(stateFile(storageDir), '[]'); // hyperspace is on
    assert.deepStrictEqual(await run(), { applied: false, ran: [] });
  });
});
