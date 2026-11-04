import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { PageHost, closeLayoutPage, openLayoutPage } from '../layoutPanel';

const context = { extensionUri: vscode.Uri.file(path.join(__dirname, '..', '..')), subscriptions: [] } as unknown as vscode.ExtensionContext;
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
function fakePanel() {
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
      reveal: () => void page.revealed++,
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
function fakeHost() {
  const pages: Array<ReturnType<typeof fakePanel>> = [];
  const events: string[] = [];
  const waits: Array<ReturnType<typeof gate>> = [];
  const restores: Array<ReturnType<typeof gate>> = [];
  const host: PageHost = {
    createPanel: () => {
      const page = fakePanel();
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
    keepEmptyGroups: async (work) => {
      events.push('hold');
      try {
        return await work();
      } finally {
        events.push('release');
      }
    },
    wait: async () => {
      const g = gate();
      waits.push(g);
      await g.promise;
    },
  };
  return { host, pages, events, waits, restores };
}

suite('layout page', () => {
  teardown(() => closeLayoutPage());

  suite('lifecycle, with a stand-in window', () => {
    test('moves to its own window while empty groups are held open, so the move cannot close a column', async () => {
      const w = fakeHost();
      openLayoutPage(context, log, undefined, w.host);
      await flush();
      assert.deepStrictEqual(w.events, ['create', 'hold', 'run workbench.action.moveEditorToNewWindow', 'release']);
    });

    test('opening it again while it is open shows the same page', async () => {
      const w = fakeHost();
      openLayoutPage(context, log, undefined, w.host);
      openLayoutPage(context, log, undefined, w.host);
      assert.strictEqual(w.pages.length, 1);
      assert.strictEqual(w.pages[0].revealed, 1);
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

      openLayoutPage(context, log, undefined, w.host);
      assert.strictEqual(w.pages.length, 2);
      assert.strictEqual(w.pages[1].revealed, 1);
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

// The real window: opening the page must not change the layout it is about.
suite('layout page, in the real window', () => {
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
