import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { PageHost, SettingsSection, closeLayoutPage, layoutRecordPath, lockedHold, openLayoutPage, recoverSavedLayout, writeAll } from '../layoutPanel';
import { withLock } from '../lock';

// The real lock files go in a folder of their own, not the extension's storage.
const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'towelwise-page-'));
const context = {
  extensionUri: vscode.Uri.file(path.join(__dirname, '..', '..')),
  globalStorageUri: vscode.Uri.file(storage),
  subscriptions: [],
} as unknown as vscode.ExtensionContext;
const log = () => undefined;
const flush = () => new Promise((resolve) => setImmediate(resolve));

const gate = () => {
  let release!: () => void;
  let fail!: (e: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  return { promise, release, fail };
};

// A page that records what is sent to it and lets the test send what the page would send.
function fakePanel(events: string[]) {
  const posted: Array<Record<string, unknown>> = [];
  const listeners: Array<() => void> = [];
  let handler: ((message: unknown) => unknown) | undefined;
  const page = {
    posted,
    revealed: 0,
    disposed: false,
    send: (message: unknown) => handler?.(message),
    panel: {
      webview: {
        html: '',
        cspSource: 'test',
        asWebviewUri: (uri: vscode.Uri) => uri,
        postMessage: async (message: Record<string, unknown>) => void posted.push(message),
        onDidReceiveMessage: (h: (message: unknown) => unknown) => {
          handler = h;
          return { dispose() {} };
        },
      },
      reveal: () => {
        page.revealed++;
        events.push('reveal');
      },
      dispose: () => {
        if (page.disposed) return;
        page.disposed = true;
        listeners.splice(0).forEach((l) => l());
      },
      onDidDispose: (l: () => void) => {
        listeners.push(l);
        return { dispose() {} };
      },
    },
  };
  return page;
}

// The window, with the three things the page waits on under the test's control.
function fakeHost(options: { busy?: boolean; gatedHold?: boolean } = {}) {
  const pages: Array<ReturnType<typeof fakePanel>> = [];
  const events: string[] = [];
  const waits: Array<ReturnType<typeof gate>> = [];
  const restores: Array<ReturnType<typeof gate>> = [];
  const holds: Array<ReturnType<typeof gate>> = [];
  const logged: string[] = [];
  const host: PageHost = {
    createPanel: () => {
      const page = fakePanel(events);
      pages.push(page);
      events.push('create');
      return page.panel as unknown as vscode.WebviewPanel;
    },
    run: async (command) => {
      events.push(`run ${command}`);
      if (command === 'towelwise.layout.restore') {
        const g = gate();
        restores.push(g);
        await g.promise;
      }
      return undefined;
    },
    holdEmptyGroups: async (work) => {
      if (options.busy) return false;
      events.push('hold');
      try {
        if (options.gatedHold) {
          const g = gate();
          holds.push(g);
          await g.promise;
        }
        await work();
        return true;
      } finally {
        events.push('release');
      }
    },
    shells: async () => ['default'],
    wait: async () => {
      const g = gate();
      waits.push(g);
      await g.promise;
    },
  };
  return { host, pages, events, waits, restores, holds, logged };
}

suite('layout page', () => {
  suiteTeardown(() => fs.rmSync(storage, { recursive: true, force: true }));
  teardown(() => closeLayoutPage());

  suite('lifecycle, with a stand-in window', () => {
    test('moves to its own window while empty groups are held open, so the move cannot close a column', async () => {
      const w = fakeHost();
      openLayoutPage(context, log, undefined, w.host);
      await flush();
      assert.deepStrictEqual(w.events, ['create', 'hold', 'reveal', 'run workbench.action.moveEditorToNewWindow', 'release']);
    });

    test('a page closed while the hold is pending is not moved, and no other editor is moved in its place', async () => {
      const w = fakeHost({ gatedHold: true });
      openLayoutPage(context, log, undefined, w.host);
      await flush();
      w.pages[0].panel.dispose();
      w.holds[0].release();
      await flush();
      assert.deepStrictEqual(w.events, ['create', 'hold', 'release'], 'nothing was revealed or moved');
    });

    test('the page is made the active editor right before the move, whatever was active while the hold was pending', async () => {
      const w = fakeHost({ gatedHold: true });
      openLayoutPage(context, log, undefined, w.host);
      await flush();
      w.holds[0].release();
      await flush();
      const at = w.events.indexOf('run workbench.action.moveEditorToNewWindow');
      assert.ok(at > 0 && w.events[at - 1] === 'reveal', `the page is revealed just before the move: ${w.events.join(', ')}`);
    });

    test('when a restore or jump is running elsewhere, the page stays where it opened and says so', async () => {
      const w = fakeHost({ busy: true });
      const lines: string[] = [];
      openLayoutPage(context, (line) => lines.push(line), undefined, w.host);
      await flush();
      assert.deepStrictEqual(w.events, ['create']);
      assert.strictEqual(lines.length, 1);
      assert.match(lines[0], /stayed in this window/);
    });

    test('opening it again while it is open shows the same page', async () => {
      const w = fakeHost();
      openLayoutPage(context, log, undefined, w.host);
      await flush();
      const before = w.pages[0].revealed;
      openLayoutPage(context, log, undefined, w.host);
      assert.strictEqual(w.pages.length, 1);
      assert.strictEqual(w.pages[0].revealed, before + 1);
    });

    test('Choose Layout during a restore opens nothing, and the page comes back with the unsaved draft', async () => {
      const w = fakeHost();
      openLayoutPage(context, log, undefined, w.host);
      await w.pages[0].send({ type: 'place', agent: 'codex', place: 'right' });

      const restoring = w.pages[0].send({ type: 'restore' });
      await flush();
      assert.strictEqual(w.pages[0].disposed, true, 'the page closes before the restore');

      // In the wait for focus, and again while the restore runs.
      openLayoutPage(context, log, undefined, w.host);
      w.waits[0].release();
      await flush();
      openLayoutPage(context, log, undefined, w.host);
      assert.strictEqual(w.pages.length, 1, 'no second page while the restore runs');

      w.restores[0].release();
      await restoring;
      assert.strictEqual(w.pages.length, 2, 'the page comes back once');

      await w.pages[1].send({ type: 'ready' });
      const agents = w.pages[1].posted.at(-1)?.agents as Array<{ id: string; place: string }>;
      assert.strictEqual(agents.find((a) => a.id === 'codex')?.place, 'right', 'the unsaved change survived');
    });

    test('the page comes back even when the restore fails, and a later Choose Layout shows that page', async () => {
      const w = fakeHost();
      openLayoutPage(context, log, undefined, w.host);
      const restoring = w.pages[0].send({ type: 'restore' });
      await flush();
      w.waits[0].release();
      await flush();
      w.restores[0].fail(new Error('boom'));
      await restoring;
      assert.strictEqual(w.pages.length, 2);

      const before = w.pages[1].revealed;
      openLayoutPage(context, log, undefined, w.host);
      assert.strictEqual(w.pages.length, 2);
      assert.strictEqual(w.pages[1].revealed, before + 1);
    });

    test('a page closed after the restore stays closed and the next Choose Layout starts from what is saved', async () => {
      const w = fakeHost();
      openLayoutPage(context, log, undefined, w.host);
      await w.pages[0].send({ type: 'place', agent: 'codex', place: 'right' });
      const restoring = w.pages[0].send({ type: 'restore' });
      await flush();
      w.waits[0].release();
      await flush();
      w.restores[0].release();
      await restoring;

      await w.pages[1].send({ type: 'cancel' });
      assert.strictEqual(w.pages[1].disposed, true);
      openLayoutPage(context, log, undefined, w.host);
      assert.strictEqual(w.pages.length, 3);
      await w.pages[2].send({ type: 'ready' });
      const agents = w.pages[2].posted.at(-1)?.agents as Array<{ id: string; place: string }>;
      assert.notStrictEqual(agents.find((a) => a.id === 'codex')?.place, 'right', 'closing the page dropped its draft');
    });
  });
});

// The page's hold of the empty-groups setting is the same kind of writer as a restore's, and other windows
// share the setting, so the two take the same cross-window lock. Another window is another process with its own
// lock file, which the lock treats exactly as it treats a second holder here.
suite('layout page hold and the cross-window lock', () => {
  let dir: string;
  setup(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'towelwise-hold-'))));
  teardown(() => fs.rmSync(dir, { recursive: true, force: true }));
  const editors = { keepEmptyGroups: async <T,>(work: () => Promise<T>) => work() };

  test('while a restore holds the lock the page does not take its hold, and says it did not', async () => {
    const restore = gate();
    const restoring = withLock<string>(dir, async () => (await restore.promise, 'done'), 'busy');
    let ran = false;
    const held = await lockedHold(dir, editors)(async () => void (ran = true));
    assert.strictEqual(held, false);
    assert.strictEqual(ran, false);
    restore.release();
    await restoring;
    assert.strictEqual(await lockedHold(dir, editors)(async () => void (ran = true)), true, 'free again once the restore ends');
    assert.strictEqual(ran, true);
  });

  test('while the page holds, a restore in another window is told it is busy and changes nothing', async () => {
    const inside = gate();
    const release = gate();
    const holding = lockedHold(dir, editors)(async () => {
      inside.release();
      await release.promise;
    });
    await inside.promise;
    let restored = false;
    const outcome = await withLock(dir, async () => void (restored = true), 'busy');
    assert.strictEqual(outcome, 'busy');
    assert.strictEqual(restored, false);
    release.release();
    assert.strictEqual(await holding, true);
    assert.strictEqual(await withLock(dir, async () => 'ran', 'busy'), 'ran', 'the lock is released after the page holds');
  });

  test('the lock is released when the move fails, and the failure reaches the caller', async () => {
    await assert.rejects(() => lockedHold(dir, editors)(async () => Promise.reject(new Error('boom'))), /boom/);
    assert.strictEqual(await withLock(dir, async () => 'ran', 'busy'), 'ran');
  });
});

// The real window: opening the page must not change the layout it is about.
suite('layout page, in the real window', () => {
  suiteTeardown(() => fs.rmSync(storage, { recursive: true, force: true }));
  const columns = () => vscode.window.tabGroups.all.filter((g) => !g.tabs.some((t) => t.label === 'Choose Layout'));
  const pageGroup = () => vscode.window.tabGroups.all.find((g) => g.tabs.some((t) => t.label === 'Choose Layout'));

  teardown(async () => {
    closeLayoutPage();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{ size: 1 }] });
  });

  test('opening and closing it keeps a planned empty column, when the page opens in that column', async () => {
    await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{ size: 0.5 }, { size: 0.5 }] });
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(__filename), { viewColumn: 2, preview: false });
    await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
    assert.strictEqual(columns().length, 2);

    openLayoutPage(context, log);
    // The page is a tab of the empty first column until it moves, then it is in a group of its own window.
    for (let i = 0; i < 100 && !(pageGroup() && columns().length + 1 === vscode.window.tabGroups.all.length && pageGroup()!.viewColumn > 2); i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(pageGroup() && pageGroup()!.viewColumn > 2, 'the page moved out of the main window');
    assert.strictEqual(columns().length, 2, 'the empty column was kept');
    assert.strictEqual(columns()[0].tabs.length, 0, 'the empty column is still the empty one');

    // Closing while the hold is still on would leave the window's empty group, so wait for it to end.
    const setting = () => vscode.workspace.getConfiguration('workbench.editor').get('closeEmptyGroups');
    for (let i = 0; i < 100 && setting() !== true; i++) await new Promise((resolve) => setTimeout(resolve, 50));
    closeLayoutPage();
    // The window closes a moment after the page does.
    for (let i = 0; i < 100 && vscode.window.tabGroups.all.length !== 2; i++) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.strictEqual(vscode.window.tabGroups.all.length, 2, 'still two columns after the page closes');
  });
});

suite('saving the layout settings', () => {
  const fake = (failOn?: string) => {
    const values: Record<string, unknown> = { agents: 'old-agents', grid: undefined, sizes: 'old-sizes' };
    const section: SettingsSection = {
      inspect: (key) => ({ globalValue: values[key] }),
      update: async (key, value) => {
        if (key === failOn && value !== values[key] && !String(value).startsWith('old')) throw new Error(`${key} is locked`);
        values[key] = value;
      },
    };
    return { values, section };
  };
  const next = { agents: 'new-agents', grid: 'new-grid', sizes: 'new-sizes' };

  test('writes all three', async () => {
    const { values, section } = fake();
    await writeAll(section, next);
    assert.deepStrictEqual(values, { agents: 'new-agents', grid: 'new-grid', sizes: 'new-sizes' });
  });

  test('a failure on the second puts the first back and still reports the failure', async () => {
    const { values, section } = fake('grid');
    await assert.rejects(() => writeAll(section, next), /grid is locked/);
    assert.deepStrictEqual(values, { agents: 'old-agents', grid: undefined, sizes: 'old-sizes' });
  });

  test('a failure on the third puts back the first two, including a setting that had no value', async () => {
    const { values, section } = fake('sizes');
    await assert.rejects(() => writeAll(section, next), /sizes is locked/);
    assert.deepStrictEqual(values, { agents: 'old-agents', grid: undefined, sizes: 'old-sizes' });
  });

  test('a failure while putting back does not hide the original failure', async () => {
    const { section } = fake('grid');
    const failing: SettingsSection = {
      inspect: section.inspect,
      update: async (key, value, target) => {
        if (String(value).startsWith('old')) throw new Error('cannot undo');
        return section.update(key, value, target);
      },
    };
    await assert.rejects(() => writeAll(failing, next), /grid is locked/);
  });
});

suite('saving the layout settings, with a record on disk', () => {
  let dir: string;
  const record = () => layoutRecordPath(dir);
  setup(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-saved-'));
  });
  teardown(() => fs.rmSync(dir, { recursive: true, force: true }));

  const old: Record<string, unknown> = { agents: { claude: 'left' }, grid: undefined, sizes: { sidebar: 0.2 } };
  const next: Record<string, unknown> = { agents: { claude: 'right' }, grid: { orientation: 0 }, sizes: { sidebar: 0.3 } };
  const asValues = (v: Record<string, unknown>) => v as { agents: unknown; grid: unknown; sizes: unknown };

  const fake = (start: Record<string, unknown>, failWrite: (key: string, value: unknown) => boolean = () => false) => {
    const values: Record<string, unknown> = { ...start };
    const writes: string[] = [];
    const section: SettingsSection = {
      inspect: (key) => ({ globalValue: values[key] }),
      update: async (key, value) => {
        if (failWrite(key, value)) throw new Error(`${key} is locked`);
        writes.push(key);
        values[key] = value;
      },
    };
    return { values, writes, section };
  };

  // The record's own shape for a set of old values.
  const entries = (values: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === undefined ? { had: false } : { had: true, value: v }]));

  test('the old values are on disk while the settings are written, and gone after', async () => {
    const seen: boolean[] = [];
    const { section } = fake(old);
    const watching: SettingsSection = {
      inspect: section.inspect,
      update: async (k, v, t) => {
        seen.push(fs.existsSync(record()));
        return section.update(k, v, t);
      },
    };
    await writeAll(watching, asValues(next), record());
    assert.deepStrictEqual(seen, [true, true, true]);
    assert.ok(!fs.existsSync(record()));
  });

  test('a record that cannot be written stops the save before anything is changed', async () => {
    const { values, writes, section } = fake(old);
    const notAFolder = path.join(dir, 'file');
    fs.writeFileSync(notAFolder, '');
    await assert.rejects(() => writeAll(section, asValues(next), path.join(notAFolder, 'x.json')));
    assert.deepStrictEqual(writes, []);
    assert.deepStrictEqual(values, old);
  });

  test('a failure that is put right leaves no record', async () => {
    const { values, section } = fake(old, (k, v) => k === 'sizes' && v === next.sizes);
    await assert.rejects(() => writeAll(section, asValues(next), record()), /sizes is locked/);
    assert.deepStrictEqual(values, old);
    assert.ok(!fs.existsSync(record()));
  });

  test('a failure that cannot be put right keeps the record, says what could not be put back, and the next start fixes it', async () => {
    let broken = true;
    const { values, section } = fake(old, (k, v) => broken && ((k === 'grid' && v === next.grid) || (k === 'agents' && v === old.agents)));
    await assert.rejects(
      () => writeAll(section, asValues(next), record()),
      (e: Error) => /grid is locked/.test(e.message) && /agents/.test(e.message) && /next time/.test(e.message),
    );
    assert.deepStrictEqual(values.agents, next.agents, 'the half-saved mix is what is left');
    assert.ok(fs.existsSync(record()), 'so the old values stay on disk');
    broken = false;
    assert.strictEqual(await recoverSavedLayout(dir, section), true);
    assert.deepStrictEqual(values, old);
    assert.ok(!fs.existsSync(record()));
  });

  suite('saving again after a save that could not be put right', () => {
    // The first save fails on grid and cannot put agents back, so the record holds the only copy of the old agents.
    const stuckSave = async (stillBroken: () => boolean) => {
      const state = fake(old, (k, v) => stillBroken() && ((k === 'grid' && v === next.grid) || (k === 'agents' && JSON.stringify(v) === JSON.stringify(old.agents))));
      await assert.rejects(() => writeAll(state.section, asValues(next), record()), /grid is locked/);
      return state;
    };

    test('a retry that fails again leaves the old values on disk, and changes nothing', async () => {
      const { values, section } = await stuckSave(() => true);
      const writesBefore = JSON.stringify(values);
      await assert.rejects(() => writeAll(section, asValues(next), record()));
      assert.strictEqual(JSON.stringify(values), writesBefore, 'nothing new was written on top of the mix');
      assert.ok(fs.existsSync(record()), 'the record still holds the original agents');
    });

    test('the next start still gets the original back after a retry that failed', async () => {
      let broken = true;
      const { values, section } = await stuckSave(() => broken);
      await assert.rejects(() => writeAll(section, asValues(next), record()));
      broken = false;
      await recoverSavedLayout(dir, section);
      assert.deepStrictEqual(values, old);
    });

    test('a retry that can put the old values back does so first, then saves', async () => {
      let broken = true;
      const { values, section } = await stuckSave(() => broken);
      broken = false;
      await writeAll(section, asValues(next), record());
      assert.deepStrictEqual(values, next);
      assert.ok(!fs.existsSync(record()));
    });
  });

  suite('the next start', () => {
    // A window that died mid-save: the record is on disk and the settings named here already carry their new values.
    const diedAfter = (written: string[]) => {
      const { values, section } = fake(old);
      fs.writeFileSync(record(), JSON.stringify({ before: entries(old), after: next }));
      for (const key of written) values[key] = next[key];
      return { values, section };
    };

    test('puts back the settings a cut-short save had already written', async () => {
      const { values, section } = diedAfter(['agents']);
      assert.strictEqual(await recoverSavedLayout(dir, section), true);
      assert.deepStrictEqual(values, old);
      assert.ok(!fs.existsSync(record()));
    });

    test('a setting that had no value gets none again', async () => {
      const { values, section } = diedAfter(['agents', 'grid']);
      await recoverSavedLayout(dir, section);
      assert.strictEqual(values.grid, undefined);
      assert.deepStrictEqual(values, old);
    });

    test('a save that did finish is kept, and only the record is dropped', async () => {
      const { values, section } = diedAfter(['agents', 'grid', 'sizes']);
      await recoverSavedLayout(dir, section);
      assert.deepStrictEqual(values, next);
      assert.ok(!fs.existsSync(record()));
    });

    test('a setting the user changed since is left alone', async () => {
      const { values, section } = diedAfter(['agents', 'grid']);
      values.agents = { claude: 'bottom' };
      await recoverSavedLayout(dir, section);
      assert.deepStrictEqual(values.agents, { claude: 'bottom' });
      assert.strictEqual(values.grid, undefined, 'the one still carrying the new value is put back');
      assert.ok(!fs.existsSync(record()));
    });

    test('a save that is still going in another window is left alone', async () => {
      const { values, section } = diedAfter(['agents']);
      const outcome = await withLock(dir, () => recoverSavedLayout(dir, section), true);
      assert.strictEqual(outcome, false);
      assert.deepStrictEqual(values.agents, next.agents);
      assert.ok(fs.existsSync(record()));
    });

    test('with no record there is nothing to do', async () => {
      const { values, section } = fake(old);
      assert.strictEqual(await recoverSavedLayout(dir, section), false);
      assert.deepStrictEqual(values, old);
    });

    test('a put-back that fails keeps the record for the start after', async () => {
      const { values, section } = diedAfter(['agents']);
      const failing: SettingsSection = { inspect: section.inspect, update: async () => Promise.reject(new Error('still locked')) };
      await assert.rejects(() => recoverSavedLayout(dir, failing), /still locked/);
      assert.ok(fs.existsSync(record()));
      await recoverSavedLayout(dir, section);
      assert.deepStrictEqual(values, old);
    });

    test('an old value that says it was there but is not given is dropped, not taken as "no value"', async () => {
      const { values, section } = fake(old);
      values.agents = next.agents;
      const before = { ...entries(old), agents: { had: true } };
      fs.writeFileSync(record(), JSON.stringify({ before, after: next }));
      assert.strictEqual(await recoverSavedLayout(dir, section), false);
      assert.deepStrictEqual(values.agents, next.agents, 'the setting is left as it is');
      assert.ok(!fs.existsSync(record()));
    });

    for (const [name, text] of [
      ['not JSON', '{not json'],
      ['null', 'null'],
      ['an empty object', '{}'],
      ['missing a setting', JSON.stringify({ before: { agents: { had: false }, grid: { had: false } }, after: next })],
      ['with a "had" that is not a flag', JSON.stringify({ before: { agents: { had: 1 }, grid: { had: false }, sizes: { had: false } }, after: next })],
    ] as const) {
      test(`a record that is ${name} is dropped and the settings are left as they are`, async () => {
        const { values, section } = fake(next);
        fs.writeFileSync(record(), text);
        assert.strictEqual(await recoverSavedLayout(dir, section), false);
        assert.deepStrictEqual(values, next);
        assert.ok(!fs.existsSync(record()));
      });
    }
  });
});
