import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { PageHost, closeLayoutPage, lockedHold, openLayoutPage } from '../layoutPanel';
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
