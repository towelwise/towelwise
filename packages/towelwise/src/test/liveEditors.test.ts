import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { keepHoldRecordIn, liveEditors, recoverHeldSetting, setMainGroupCount, watchTabs } from '../liveEditors';
import { withLock } from '../lock';
import { failReadOf } from './readFailure';

// These run against the real editor area of the test window: the adapter is what the built app uses.
const settings = () => vscode.workspace.getConfiguration('workbench.editor');
const globalValue = () => settings().inspect<boolean>('closeEmptyGroups')?.globalValue;
const setGlobal = (value: boolean | undefined) => settings().update('closeEmptyGroups', value, vscode.ConfigurationTarget.Global);

const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
};

async function until(condition: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`timed out waiting for ${what}`);
}

const tenColumns = { orientation: 0, groups: Array.from({ length: 10 }, () => ({ size: 0.1 })) };

// Files on disk, so closing them later asks nothing.
const open = async (file: string, viewColumn: number) =>
  vscode.window.showTextDocument(await vscode.workspace.openTextDocument(path.join(__dirname, file)), { viewColumn, preview: false });

suite('live editors', () => {
  let original: boolean | undefined;
  setup(() => {
    original = globalValue();
  });
  teardown(async () => {
    await setGlobal(original);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{ size: 1 }] });
  });

  suite('holding empty groups open', () => {
    test("overlapping holds share one: the first to finish does not end the second's, and the last puts the setting back exactly", async () => {
      await setGlobal(undefined);
      const a = gate();
      const b = gate();
      const first = liveEditors.keepEmptyGroups(() => a.promise);
      await until(() => settings().get('closeEmptyGroups') === false, 'the first hold');
      const second = liveEditors.keepEmptyGroups(() => b.promise);
      a.release();
      await first;
      assert.strictEqual(settings().get('closeEmptyGroups'), false, 'the second run lost its hold');
      b.release();
      await second;
      assert.strictEqual(globalValue(), undefined, 'the user had no value, so none is left');
      assert.strictEqual(settings().get('closeEmptyGroups'), true);
    });

    test('a value the user had set is put back as it was', async () => {
      await setGlobal(true);
      await liveEditors.keepEmptyGroups(async () => {
        assert.strictEqual(settings().get('closeEmptyGroups'), false);
      });
      assert.strictEqual(globalValue(), true);
    });

    test('the setting is put back when the work fails, and the failure still reaches the caller', async () => {
      await setGlobal(undefined);
      await assert.rejects(() => liveEditors.keepEmptyGroups(async () => Promise.reject(new Error('boom'))), /boom/);
      assert.strictEqual(globalValue(), undefined);
    });

    test('a user who already keeps empty groups is left alone', async () => {
      await setGlobal(false);
      await liveEditors.keepEmptyGroups(async () => undefined);
      assert.strictEqual(globalValue(), false);
    });
  });

  suite('after a restore cut short', () => {
    let dir: string;
    let pending: { release: () => void; done: Promise<unknown> } | undefined;
    const record = () => path.join(dir, 'closeEmptyGroups.held.json');
    setup(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-held-'));
      keepHoldRecordIn(dir);
    });
    teardown(async () => {
      // Let the pretend-dead hold end, so the next test does not join it.
      pending?.release();
      await pending?.done;
      pending = undefined;
      keepHoldRecordIn(undefined);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    // A window that dies mid-restore never reaches its finally block; the setting is off and the record is what is left.
    const crashDuringHold = async (before: boolean | undefined) => {
      await setGlobal(before);
      const stuck = gate();
      pending = { release: stuck.release, done: liveEditors.keepEmptyGroups(() => stuck.promise) };
      await until(() => settings().get('closeEmptyGroups') === false && fs.existsSync(record()), 'the hold');
      // Not released until teardown: until then the window has "died".
    };

    test('a finished hold leaves no record behind', async () => {
      await setGlobal(undefined);
      await liveEditors.keepEmptyGroups(async () => {
        assert.ok(fs.existsSync(record()), 'the value is on disk while the setting is held off');
      });
      assert.ok(!fs.existsSync(record()));
    });

    test('the next start puts back the value the user had', async () => {
      await crashDuringHold(true);
      assert.strictEqual(await recoverHeldSetting(dir), true);
      assert.strictEqual(globalValue(), true);
      assert.ok(!fs.existsSync(record()));
    });

    test('and puts back "no value" when the user had none', async () => {
      await crashDuringHold(undefined);
      await recoverHeldSetting(dir);
      assert.strictEqual(globalValue(), undefined);
    });

    test('a value the user changed since is not overwritten', async () => {
      await crashDuringHold(true);
      await setGlobal(true);
      await recoverHeldSetting(dir);
      assert.strictEqual(globalValue(), true);
      assert.ok(!fs.existsSync(record()));
    });

    test('a hold that is still live elsewhere is left alone', async () => {
      await crashDuringHold(true);
      const outcome = await withLock(dir, () => recoverHeldSetting(dir), true);
      assert.strictEqual(outcome, false, 'the lock is held, so recovery backs off');
      assert.strictEqual(globalValue(), false);
      assert.ok(fs.existsSync(record()));
    });

    test('a record that cannot be read for a moment is kept, and the next start still puts the value back', async () => {
      await crashDuringHold(true);
      const failing = failReadOf(record());
      try {
        await assert.rejects(() => recoverHeldSetting(dir), /could not be read/);
      } finally {
        failing.restore();
      }
      assert.ok(fs.existsSync(record()), 'the only copy of the user\'s value is still there');
      assert.strictEqual(await recoverHeldSetting(dir), true);
      assert.strictEqual(globalValue(), true);
    });

    test('an unreadable record is dropped and the setting is left as it is', async () => {
      await setGlobal(false);
      fs.writeFileSync(record(), '{not json');
      assert.strictEqual(await recoverHeldSetting(dir), false);
      assert.strictEqual(globalValue(), false);
      assert.ok(!fs.existsSync(record()));
    });

    for (const [name, text] of [
      ['null', 'null'],
      ['an empty object', '{}'],
      ['a list', '[true]'],
      ['a "had" that is not a flag', '{"had":"yes","value":true}'],
      ['a value that is not a flag', '{"had":true,"value":"x"}'],
      ['a value missing where one was had', '{"had":true}'],
    ] as const) {
      test(`a record that is ${name} is dropped and the setting is left as it is`, async () => {
        await setGlobal(false);
        fs.writeFileSync(record(), text);
        assert.strictEqual(await recoverHeldSetting(dir), false);
        assert.strictEqual(globalValue(), false);
        assert.ok(!fs.existsSync(record()));
      });
    }

    test('without a saved record the setting is not held off, and the work still runs', async () => {
      // A file where the folder should be: the record cannot be written.
      const notAFolder = path.join(dir, 'file');
      fs.writeFileSync(notAFolder, '');
      keepHoldRecordIn(notAFolder);
      await setGlobal(true);
      let ran = false;
      await liveEditors.keepEmptyGroups(async () => {
        ran = true;
        assert.strictEqual(settings().get('closeEmptyGroups'), true, 'the setting stays as it is');
      });
      assert.ok(ran);
      assert.strictEqual(globalValue(), true);
    });
  });

  suite('holding a group across a change', () => {
    test('a group an agent opens for itself is tracked, so the groups held before stay the same groups', async () => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{ size: 0.4 }, { size: 0.3 }, { size: 0.3 }] });
      await open('liveEditors.test.js', 1);
      await open('columns.test.js', 3);
      const before = liveEditors.groups();
      assert.strictEqual(before.length, 3);
      await liveEditors.focus(before[0]);

      // A new group appears between the first and the second, with one tab in it that has Claude Code's view type: the
      // shift Claude Code's own group causes when it opens.
      const opened = liveEditors.waitForTab('claudeCode', 10000);
      await vscode.commands.executeCommand('workbench.action.newGroupRight');
      const panel = vscode.window.createWebviewPanel('claudeVSCodePanel', 'Claude Code (stand-in)', { viewColumn: vscode.ViewColumn.Two }, {});
      try {
        assert.ok(await opened, 'the stand-in tab never opened');
        const after = liveEditors.groups();
        assert.strictEqual(after.length, 4);
        assert.deepStrictEqual([after[0], after[2], after[3]], [before[0], before[1], before[2]], 'the groups held before are not the same groups after');
        assert.strictEqual(liveEditors.tabs(before[0]).length, 1);
        assert.strictEqual(liveEditors.tabs(before[1]).length, 0);
        assert.strictEqual(liveEditors.tabs(before[2]).length, 1);
        assert.deepStrictEqual(liveEditors.tabs(after[1]).map((t) => liveEditors.kind(t)), ['claudeCode']);

        // And it can be moved into a held group, and the group it left closed by its handle, leaving the others.
        await liveEditors.keepEmptyGroups(async () => {
          await liveEditors.moveTab(liveEditors.tabs(after[1])[0], before[1]);
          await liveEditors.closeGroup(after[1]);
        });
        const last = liveEditors.groups();
        assert.strictEqual(last.length, 3);
        assert.deepStrictEqual(last, [before[0], before[1], before[2]]);
        assert.deepStrictEqual(liveEditors.tabs(before[1]).map((t) => liveEditors.kind(t)), ['claudeCode']);
      } finally {
        panel.dispose();
      }
    });
  });

  suite('other editor windows', () => {
    test("with the main window's count read, a floating window's groups are left out until all windows are wanted again", async function () {
      this.timeout(30000);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{ size: 0.5 }, { size: 0.5 }] });
      await open('liveEditors.test.js', 1);
      await open('columns.test.js', 2);
      await open('grid.test.js', 2);
      // The active file moves to a window of its own, as Choose Layout's page does; its group keeps the other file.
      await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
      await until(() => vscode.window.tabGroups.all.length === 3, 'the floating window');
      const restore = setMainGroupCount(async () => 2);
      try {
        assert.strictEqual(liveEditors.groups().length, 3, 'every window is listed until the main one is asked for');
        await liveEditors.useMainWindow();
        const main = liveEditors.groups();
        assert.strictEqual(main.length, 2);
        const labels = main.flatMap((g) => liveEditors.tabs(g).map((t) => liveEditors.label(t)));
        assert.ok(labels.includes('columns.test.js') && !labels.includes('grid.test.js'), labels.join(', '));
        liveEditors.useAllWindows();
        assert.strictEqual(liveEditors.groups().length, 3);
      } finally {
        restore();
        liveEditors.useAllWindows();
        // Closing every tab in every window closes the floating one too.
        await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap((g) => g.tabs));
        await until(() => vscode.window.tabGroups.all.length <= 2, 'the floating window to close');
      }
    });

    test("a floating window closing during a restore leaves the main window's groups, and the handles held for them, as they were", async function () {
      this.timeout(30000);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{ size: 0.5 }, { size: 0.5 }] });
      await open('liveEditors.test.js', 1);
      await open('columns.test.js', 2);
      await open('grid.test.js', 2);
      await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
      await until(() => vscode.window.tabGroups.all.length === 3, 'the floating window');
      const restore = setMainGroupCount(async () => 2);
      try {
        await liveEditors.useMainWindow();
        const held = liveEditors.groups();
        assert.strictEqual(held.length, 2);
        // The floating window closes with no new count read: the next thing a restore does is use the handles.
        await vscode.window.tabGroups.close(vscode.window.tabGroups.all[2].tabs);
        await until(() => vscode.window.tabGroups.all.length === 2, 'the floating window to close');
        const after = liveEditors.groups();
        assert.strictEqual(after.length, held.length);
        held.forEach((handle, i) => assert.strictEqual(after[i], handle, `handle ${i} is not the same group`));
        assert.strictEqual(liveEditors.tabs(held[0]).length, 1);
      } finally {
        restore();
        liveEditors.useAllWindows();
      }
    });

    test('a floating window closing while an agent opens a group of its own keeps every handle held for the main groups', async function () {
      this.timeout(30000);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{ size: 0.5 }, { size: 0.5 }] });
      await open('liveEditors.test.js', 1);
      await open('columns.test.js', 2);
      await open('grid.test.js', 2);
      await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
      await until(() => vscode.window.tabGroups.all.length === 3, 'the floating window');
      // What the core bridge answers, as it changes: the main window has two groups, then the agent's makes three.
      let main = 2;
      const restore = setMainGroupCount(async () => main);
      let panel: vscode.WebviewPanel | undefined;
      try {
        await liveEditors.useMainWindow();
        const held = liveEditors.groups();
        assert.strictEqual(held.length, 2);
        // The floating window closes, then Claude Code's group opens in the main window, so the total of all groups is
        // the same as before while the main window has one more.
        await vscode.window.tabGroups.close(vscode.window.tabGroups.all[2].tabs);
        await until(() => vscode.window.tabGroups.all.length === 2, 'the floating window to close');
        // Closing a window can move focus (it does in older VS Code), so the first group is focused after it.
        await liveEditors.focus(held[0]);
        const opened = liveEditors.waitForTab('claudeCode', 10000);
        await vscode.commands.executeCommand('workbench.action.newGroupRight');
        main = 3;
        panel = vscode.window.createWebviewPanel('claudeVSCodePanel', 'Claude Code (stand-in)', { viewColumn: vscode.ViewColumn.Two }, {});
        assert.ok(await opened, 'the stand-in tab never opened');
        await liveEditors.useMainWindow();
        const after = liveEditors.groups();
        assert.strictEqual(after.length, 3);
        assert.strictEqual(after[0], held[0], 'the first handle is not the same group');
        assert.strictEqual(after[2], held[1], 'the second handle is not the same group');
        assert.deepStrictEqual(liveEditors.tabs(after[1]).map((t) => liveEditors.kind(t)), ['claudeCode']);
      } finally {
        panel?.dispose();
        restore();
        liveEditors.useAllWindows();
      }
    });

    test('without the bridge, every group counts, as before', async () => {
      const restore = setMainGroupCount(async () => {
        throw new Error("command '_towelwise.layout.mainGroupCount' not found");
      });
      try {
        await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{ size: 0.5 }, { size: 0.5 }] });
        await liveEditors.useMainWindow();
        assert.strictEqual(liveEditors.groups().length, vscode.window.tabGroups.all.length);
      } finally {
        restore();
        liveEditors.useAllWindows();
      }
    });
  });

  suite('waiting for a revived terminal\'s name', () => {
    test('returns at once when no terminal tab is missing its name, with or without a terminal open', async () => {
      const quickly = async () => {
        const started = Date.now();
        await liveEditors.settled(5000);
        assert.ok(Date.now() - started < 1000);
      };
      await quickly();
      const terminal = vscode.window.createTerminal({ name: 'named', location: { viewColumn: vscode.ViewColumn.One } });
      try {
        await until(() => vscode.window.tabGroups.all.some((g) => g.tabs.some((t) => t.input instanceof vscode.TabInputTerminal)), 'the terminal tab');
        await quickly();
      } finally {
        terminal.dispose();
      }
    });
  });

  suite('a terminal opened for a cell', () => {
    // A reloaded window brings persistent terminals back under their process's title ("bash"), not the name given here, so
    // a restore could not tell them from new ones and doubled every terminal cell (seen in the built app, 2026-11-05).
    test('is not restored by VS Code on reload, because the layout opens it again', async () => {
      await liveEditors.openTerminal(liveEditors.groups()[0], { name: 'Towelwise test terminal' });
      const terminal = vscode.window.terminals.find((t) => t.name === 'Towelwise test terminal');
      try {
        assert.ok(terminal, 'the terminal opened');
        assert.strictEqual((terminal.creationOptions as vscode.TerminalOptions).isTransient, true);
      } finally {
        terminal?.dispose();
      }
    });
  });

  suite('watching tabs of some kinds, for the "also open as a tab" report', () => {
    test('fires when a tab of a watched kind opens or closes, and not for a plain file', async () => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      let fired = 0;
      const watching = watchTabs(['terminal'], () => void fired++);
      try {
        await open('columns.test.js', 1);
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.strictEqual(fired, 0, 'a file is not a terminal');

        const terminal = vscode.window.createTerminal({ name: 'watched', location: { viewColumn: vscode.ViewColumn.One } });
        await until(() => fired > 0, 'the terminal tab opening');
        const opened = fired;
        terminal.dispose();
        await until(() => fired > opened, 'the terminal tab closing');
      } finally {
        watching.dispose();
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      }
      const after = fired;
      await open('columns.test.js', 1);
      assert.strictEqual(fired, after, 'nothing is reported once the watch is disposed');
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });
  });

  suite('groups past the eighth', () => {
    test('can focus the tenth group and move a tab out of it, and the groups stay', async () => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.commands.executeCommand('vscode.setEditorLayout', tenColumns);
      await open('liveEditors.test.js', 1);
      await open('columns.test.js', 10);
      const groups = liveEditors.groups();
      assert.strictEqual(groups.length, 10);

      await liveEditors.focus(groups[9]);
      assert.strictEqual(vscode.window.tabGroups.activeTabGroup.viewColumn, vscode.window.tabGroups.all[9].viewColumn);

      const tab = liveEditors.tabs(groups[9])[0];
      await liveEditors.keepEmptyGroups(async () => {
        await liveEditors.moveTab(tab, groups[0]);
      });
      assert.strictEqual(liveEditors.tabs(groups[0]).length, 2);
      assert.strictEqual(liveEditors.tabs(groups[9]).length, 0);
      assert.strictEqual(liveEditors.groups().length, 10, 'a cell closed');
    });

    test('can move a tab into the tenth group', async () => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.commands.executeCommand('vscode.setEditorLayout', tenColumns);
      await open('columns.test.js', 1);
      const groups = liveEditors.groups();
      await liveEditors.keepEmptyGroups(async () => {
        await liveEditors.moveTab(liveEditors.tabs(groups[0])[0], groups[9]);
      });
      assert.strictEqual(liveEditors.tabs(groups[9]).length, 1);
      assert.strictEqual(liveEditors.groups().length, 10);
    });
  });
});
