import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { stateFile } from '../hyperspace';
import { applyOnStartup, orderChoices, restoreLayout, viewsByContainer } from '../layout';

const CONTAINERS = 'towelwise.layout.containers';
const ON_STARTUP = 'towelwise.layout.applyOnStartup';
const COMMANDS = 'towelwise.layout.commands';
const GLOBAL = vscode.ConfigurationTarget.Global;
const config = () => vscode.workspace.getConfiguration();

// A stand-in for VS Code: which show commands exist, each container's first view, and a record of the commands that ran.
const fakeVsCode = (available: string[], views: Record<string, string> = {}, failOn?: string) => {
  const ran: string[] = [];
  const logged: string[] = [];
  return {
    ran,
    logged,
    available: new Set(available),
    views: new Map(Object.entries(views)),
    run: async (command: string) => {
      ran.push(command);
      if (command === failOn) throw new Error('command failed');
    },
    log: (line: string) => void logged.push(line),
  };
};

suite('layout', () => {
  let storageDir: string;

  setup(() => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'towelwise-layout-'));
  });

  teardown(async () => {
    await config().update(CONTAINERS, undefined, GLOBAL);
    await config().update(CONTAINERS, undefined, vscode.ConfigurationTarget.Workspace).then(undefined, () => undefined);
    await config().update(ON_STARTUP, undefined, GLOBAL);
    await config().update(COMMANDS, undefined, GLOBAL);
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  test('restore shows each saved container, in saved order', async () => {
    await config().update(CONTAINERS, ['codex', 'antigravity'], GLOBAL);
    const vs = fakeVsCode(['workbench.view.extension.antigravity', 'workbench.view.extension.codex']);

    const result = await restoreLayout(vs);
    assert.deepStrictEqual(vs.ran, ['workbench.view.extension.codex', 'workbench.view.extension.antigravity']);
    assert.deepStrictEqual(result, { ran: ['codex', 'antigravity'], skipped: [] });
  });

  test('restore skips a container that is not available, reports it, and keeps the layout', async () => {
    await config().update(CONTAINERS, ['antigravity', 'gone', 'codex'], GLOBAL);
    const vs = fakeVsCode(['workbench.view.extension.antigravity', 'workbench.view.extension.codex']);

    const result = await restoreLayout(vs);
    assert.deepStrictEqual(vs.ran, ['workbench.view.extension.antigravity', 'workbench.view.extension.codex']);
    assert.deepStrictEqual(result, { ran: ['antigravity', 'codex'], skipped: ['gone'] });
    assert.deepStrictEqual(config().get(CONTAINERS), ['antigravity', 'gone', 'codex']);
  });

  test('built-in Chat is shown with its own command', async () => {
    await config().update(CONTAINERS, ['workbench.panel.chat'], GLOBAL);
    const vs = fakeVsCode(['workbench.action.chat.open']);

    await restoreLayout(vs);
    assert.deepStrictEqual(vs.ran, ['workbench.action.chat.open']);
  });

  test('a container with a known view is shown through the view focus command, which never toggles', async () => {
    await config().update(CONTAINERS, ['codex', 'plain'], GLOBAL);
    const vs = fakeVsCode(
      ['workbench.view.extension.codex', 'codex.view.focus', 'workbench.view.extension.plain'],
      { codex: 'codex.view' },
    );

    await restoreLayout(vs);
    assert.deepStrictEqual(vs.ran, ['codex.view.focus', 'workbench.view.extension.plain']);
  });

  test('the extension that declares a container owns its first view, whatever order extensions load in', () => {
    const owner = {
      contributes: { viewsContainers: { activitybar: [{ id: 'agent' }] }, views: { agent: [{ id: 'owner.view' }] } },
    };
    const addon = { contributes: { views: { agent: [{ id: 'addon.view' }] } } };

    assert.strictEqual(viewsByContainer([addon, owner]).get('agent'), 'owner.view');
    assert.strictEqual(viewsByContainer([owner, addon]).get('agent'), 'owner.view');
  });

  test('a view from another extension is used only when the owner contributes none', () => {
    const owner = { contributes: { viewsContainers: { activitybar: [{ id: 'agent' }] } } };
    const addon = { contributes: { views: { agent: [{ id: 'addon.view' }] } } };

    assert.strictEqual(viewsByContainer([owner, addon]).get('agent'), 'addon.view');
  });

  test('a workspace setting cannot override the saved layout', async () => {
    await config().update(CONTAINERS, ['codex'], GLOBAL);
    await config().update(CONTAINERS, [], vscode.ConfigurationTarget.Workspace).then(undefined, () => undefined);
    const vs = fakeVsCode(['workbench.view.extension.codex']);

    assert.deepStrictEqual((await restoreLayout(vs)).ran, ['codex']);
  });

  test('a hand-edited layout with a non-string entry is ignored, not fatal', async () => {
    await config().update(CONTAINERS, [1, 'codex'], GLOBAL);
    const vs = fakeVsCode(['workbench.view.extension.codex']);

    assert.deepStrictEqual(await restoreLayout(vs), { ran: ['codex'], skipped: [] });
  });

  test('the picker lists saved containers first, in saved order, then the rest', () => {
    const found = ['a', 'b', 'c'].map((id) => ({ id, label: id.toUpperCase(), description: 'Side bar' }));

    assert.deepStrictEqual(orderChoices(['c', 'a'], found).map((c) => c.id), ['c', 'a', 'b']);
    assert.deepStrictEqual(orderChoices([], found).map((c) => c.id), ['a', 'b', 'c']);
  });

  test('a saved container that is no longer installed stays in the picker, marked, so it can be unticked', () => {
    const found = [{ id: 'a', label: 'A', description: 'Side bar' }];

    assert.deepStrictEqual(orderChoices(['gone', 'a'], found), [
      { id: 'gone', label: 'gone', description: 'Not installed' },
      found[0],
    ]);
  });

  test('Restore also runs the layout commands, after the containers, in order', async () => {
    await config().update(CONTAINERS, ['codex'], GLOBAL);
    await config().update(COMMANDS, ['agent.openChat', 'agent.openPanel'], GLOBAL);
    const vs = fakeVsCode(['workbench.view.extension.codex', 'agent.openChat', 'agent.openPanel']);

    const result = await restoreLayout(vs);
    assert.deepStrictEqual(vs.ran, ['workbench.view.extension.codex', 'agent.openChat', 'agent.openPanel']);
    assert.deepStrictEqual(result, { ran: ['codex', 'agent.openChat', 'agent.openPanel'], skipped: [] });
  });

  test('a layout command that does not exist is skipped and reported, and the setting is kept', async () => {
    await config().update(COMMANDS, ['agent.openChat', 'agent.gone', 1], GLOBAL);
    const vs = fakeVsCode(['agent.openChat']);

    assert.deepStrictEqual(await restoreLayout(vs), { ran: ['agent.openChat'], skipped: ['agent.gone'] });
    assert.deepStrictEqual(config().get(COMMANDS), ['agent.openChat', 'agent.gone', 1]);
  });

  test('startup apply runs the containers but not the layout commands', async () => {
    await config().update(CONTAINERS, ['codex'], GLOBAL);
    await config().update(COMMANDS, ['agent.openChat'], GLOBAL);
    await config().update(ON_STARTUP, true, GLOBAL);
    const vs = fakeVsCode(['workbench.view.extension.codex', 'agent.openChat']);

    assert.strictEqual(await applyOnStartup(storageDir, async () => vs), true);
    assert.deepStrictEqual(vs.ran, ['workbench.view.extension.codex']);
  });

  test('a layout setting hand-edited to something that is not a list is treated as empty, not fatal', async () => {
    const vs = fakeVsCode(['workbench.view.extension.codex', 'agent.openChat']);

    for (const wrong of ['codex', null, 5, { a: 1 }]) {
      await config().update(CONTAINERS, wrong, GLOBAL);
      await config().update(COMMANDS, wrong, GLOBAL);
      assert.deepStrictEqual(await restoreLayout(vs), { ran: [], skipped: [] }, JSON.stringify(wrong));
    }
    assert.deepStrictEqual(vs.ran, []);
  });

  test('Restore logs what it ran and what it skipped', async () => {
    await config().update(CONTAINERS, ['codex', 'gone'], GLOBAL);
    await config().update(COMMANDS, ['agent.openChat', 'agent.missing'], GLOBAL);
    const vs = fakeVsCode(['workbench.view.extension.codex', 'agent.openChat']);

    await restoreLayout(vs);
    assert.deepStrictEqual(vs.logged, [
      'restore layout',
      'ran workbench.view.extension.codex (container codex)',
      'skipped gone: no such command',
      'ran agent.openChat',
      'skipped agent.missing: no such command',
    ]);
  });

  test('startup apply says in the log that it runs containers only', async () => {
    await config().update(CONTAINERS, ['codex'], GLOBAL);
    await config().update(ON_STARTUP, true, GLOBAL);
    const vs = fakeVsCode(['workbench.view.extension.codex']);

    await applyOnStartup(storageDir, async () => vs);
    assert.deepStrictEqual(vs.logged, ['restore layout (containers only, on startup)', 'ran workbench.view.extension.codex (container codex)']);
  });

  test('a command that fails is logged with its error before the error is reported, and stops Restore', async () => {
    await config().update(COMMANDS, ['agent.openChat', 'agent.later'], GLOBAL);
    const vs = fakeVsCode(['agent.openChat', 'agent.later'], {}, 'agent.openChat');

    await assert.rejects(restoreLayout(vs), /command failed/);
    assert.deepStrictEqual(vs.logged, ['restore layout', 'FAILED agent.openChat: command failed']);
    assert.deepStrictEqual(vs.ran, ['agent.openChat']); // agent.later never ran
  });

  test('an empty layout runs nothing', async () => {
    const vs = fakeVsCode(['workbench.view.extension.codex']);

    assert.deepStrictEqual(await restoreLayout(vs), { ran: [], skipped: [] });
    assert.deepStrictEqual(vs.ran, []);
  });

  test('startup apply runs only when its setting is on and hyperspace is off', async () => {
    await config().update(CONTAINERS, ['codex'], GLOBAL);
    const run = async () => {
      const vs = fakeVsCode(['workbench.view.extension.codex']);
      return { applied: await applyOnStartup(storageDir, async () => vs), ran: vs.ran };
    };

    assert.deepStrictEqual(await run(), { applied: false, ran: [] });

    await config().update(ON_STARTUP, true, GLOBAL);
    assert.deepStrictEqual(await run(), { applied: true, ran: ['workbench.view.extension.codex'] });

    fs.writeFileSync(stateFile(storageDir), '[]'); // hyperspace is on
    assert.deepStrictEqual(await run(), { applied: false, ran: [] });
  });

  test('startup apply is skipped if hyperspace turns on while the environment is loading', async () => {
    await config().update(CONTAINERS, ['codex'], GLOBAL);
    await config().update(ON_STARTUP, true, GLOBAL);
    const vs = fakeVsCode(['workbench.view.extension.codex']);

    const applied = await applyOnStartup(storageDir, async () => {
      fs.writeFileSync(stateFile(storageDir), '[]'); // another window jumps while we wait
      return vs;
    });
    assert.strictEqual(applied, false);
    assert.deepStrictEqual(vs.ran, []);
  });

  test('startup does not build the VS Code environment when apply on startup is off', async () => {
    let built = 0;
    const vs = fakeVsCode(['workbench.view.extension.codex']);

    await applyOnStartup(storageDir, async () => (built++, vs));
    assert.strictEqual(built, 0);
  });
});
