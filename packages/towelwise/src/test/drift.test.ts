import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Layout } from '../grid';
import { DriftHost, DriftWatch, Live, LiveReads, captureLive, driftOf, liveDriftHost, readLive, runWhileFocused } from '../drift';
import { keepLayoutRecordIn, layoutRecordPath } from '../layoutPanel';
import { MyLayout } from '../myLayout';
import { LayoutState } from '../sizes';

const state = (over: { sidebar?: number; panel?: number; visible?: boolean } = {}): LayoutState => ({
  window: { width: 1000, height: 800 },
  panelPosition: 'bottom',
  parts: {
    sidebar: { visible: over.visible ?? true, size: over.sidebar ?? 300 },
    auxiliarybar: { visible: true, size: 300 },
    panel: { visible: true, size: over.panel ?? 200 },
  },
});

// Three columns, the third split into two rows; the live grid is given as sizes in pixels, as VS Code reports it.
const grid = (a: number, b: number, c: number, top = 1, bottom = 1): Layout => ({
  orientation: 0,
  groups: [{ size: a }, { size: b }, { size: c, groups: [{ size: top }, { size: bottom }] }],
});

const saved = (): MyLayout => ({
  agents: { claudeCode: 'column', codex: 'column' },
  grid: {
    orientation: 0,
    groups: [
      { size: 0.3, holds: 'claudeCode' },
      { size: 0.3, holds: 'codex' },
      { size: 0.4, groups: [{ size: 0.5, holds: 'terminal', terminal: { name: 'build' } }, { size: 0.5 }] },
    ],
  },
  sizes: { sidebar: 0.3, panel: 0.25, panelOrientation: 'down' },
});

const exact = (): Live => ({ grid: grid(300, 300, 400), state: state() });

suite('drift', () => {
  suite('driftOf', () => {
    test('a window that matches its layout has not drifted, and so does one within the tolerance', () => {
      assert.strictEqual(driftOf(saved(), exact()), 'none');
      assert.strictEqual(driftOf(saved(), { grid: grid(315, 285, 400), state: state({ sidebar: 320, panel: 210 }) }), 'none');
    });

    test('a proportion more than 3% of its parent away is drift', () => {
      assert.strictEqual(driftOf(saved(), { grid: grid(340, 260, 400), state: state() }), 'proportions');
      assert.strictEqual(driftOf(saved(), { grid: grid(300, 300, 400, 3, 1), state: state() }), 'proportions');
    });

    test('a side bar or panel more than 3 points of the window away is drift', () => {
      assert.strictEqual(driftOf(saved(), { grid: grid(300, 300, 400), state: state({ sidebar: 350 }) }), 'proportions');
      assert.strictEqual(driftOf(saved(), { grid: grid(300, 300, 400), state: state({ panel: 260 }) }), 'proportions');
    });

    test('a different number of columns or rows is a change of shape', () => {
      assert.strictEqual(driftOf(saved(), { grid: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] }, state: state() }), 'shape');
      assert.strictEqual(driftOf(saved(), { grid: { orientation: 1, groups: [{ size: 1 }] }, state: state() }), 'shape');
    });

    test('what cannot be compared is not drift: no live grid, no bridge, a hidden part, or a panel that moved to another side', () => {
      assert.strictEqual(driftOf(saved(), { state: state() }), 'none');
      assert.strictEqual(driftOf(saved(), { grid: grid(300, 300, 400) }), 'none');
      assert.strictEqual(driftOf(saved(), { grid: grid(300, 300, 400), state: state({ sidebar: 50, visible: false }) }), 'none');
      assert.strictEqual(driftOf({ sizes: { panel: 0.25, panelOrientation: 'across' } }, { state: state({ panel: 500 }) }), 'none');
    });

    test('a layout with only some parts saved compares only those', () => {
      assert.strictEqual(driftOf({ sizes: { sidebar: 0.3 } }, { state: state({ panel: 700 }) }), 'none');
      assert.strictEqual(driftOf({ sizes: { sidebar: 0.3 } }, { state: state({ sidebar: 400 }) }), 'proportions');
    });
  });

  suite('captureLive', () => {
    test('takes the live proportions and sizes, and keeps each cell\'s contents and each agent\'s place', () => {
      const next = captureLive(saved(), { grid: grid(200, 400, 400, 3, 1), state: state({ sidebar: 350, panel: 240 }) });
      assert.deepStrictEqual(next.agents, saved().agents);
      const [a, b, c] = next.grid!.groups;
      assert.deepStrictEqual([a.size, b.size, c.size], [0.2, 0.4, 0.4]);
      assert.strictEqual(a.holds, 'claudeCode');
      assert.strictEqual(b.holds, 'codex');
      assert.deepStrictEqual(c.groups!.map((g) => g.size), [0.75, 0.25]);
      assert.deepStrictEqual(c.groups![0].terminal, { name: 'build' });
      assert.deepStrictEqual(next.sizes, { sidebar: 0.35, panel: 0.3, panelOrientation: 'down' });
    });

    test('a part that was not in the saved sizes stays out of them', () => {
      const next = captureLive({ sizes: { sidebar: 0.3 } }, { state: state({ sidebar: 350, panel: 500 }) });
      assert.deepStrictEqual(next.sizes, { sidebar: 0.35 });
    });
  });

  suite('the prompt', () => {
    function watch(opts: { saved?: MyLayout | undefined; blocked?: boolean; answer?: string | undefined; failSave?: boolean; failRead?: boolean; hold?: Promise<string>; during?: () => void; beforeWrite?: () => void } = {}) {
      const state = { live: exact(), blocked: opts.blocked ?? false, answer: opts.answer, saved: 'saved' in opts ? opts.saved : saved() };
      const asked: { message: string; buttons: string[] }[] = [];
      const done: string[] = [];
      const told: string[] = [];
      let savedLayout: MyLayout | undefined;
      const host: DriftHost = {
        saved: () => state.saved,
        live: async () => {
          if (opts.failRead) throw new Error('bridge gone');
          return state.live;
        },
        blocked: () => state.blocked,
        ask: async (message, buttons) => {
          asked.push({ message, buttons });
          opts.during?.();
          return opts.hold ?? state.answer;
        },
        save: async (change) => {
          if (opts.failSave) throw new Error('settings are busy');
          opts.beforeWrite?.(); // another window may save before this one has the lock
          const layout = state.saved && change(state.saved);
          if (!layout) return;
          savedLayout = layout;
          done.push('save');
        },
        restore: async () => void done.push('restore'),
        edit: async () => void done.push('edit'),
        tell: (m) => told.push(m),
        log: () => undefined,
      };
      return { w: new DriftWatch(host), state, asked, done, told, savedLayout: () => savedLayout };
    }
    const drifted = (): Live => ({ grid: grid(340, 260, 400), state: state() });

    test('says nothing while the window matches', async () => {
      const t = watch();
      await t.w.check();
      assert.deepStrictEqual(t.asked, []);
    });

    test('a baseline taken without the grid does not silence the grid once it can be read again', async () => {
      const t = watch({ answer: 'Not now' });
      t.state.live = { state: state() }; // e.g. a floating window kept the grid from being read when the baseline was taken
      await t.w.settle();
      t.state.live = { grid: grid(340, 260, 400), state: state() };
      await t.w.check();
      assert.strictEqual(t.asked.length, 1);
      // Not now now records the grid too, so only a further move asks again.
      await t.w.check();
      assert.strictEqual(t.asked.length, 1);
      t.state.live = { grid: grid(400, 200, 400), state: state() };
      await t.w.check();
      assert.strictEqual(t.asked.length, 2);
    });

    test('a baseline taken with a part hidden does not silence that part once it is shown', async () => {
      const t = watch({ answer: 'Not now' });
      t.state.live = { grid: grid(300, 300, 400), state: state({ visible: false }) };
      await t.w.settle();
      t.state.live = { grid: grid(300, 300, 400), state: state({ sidebar: 400 }) }; // saved 30%, shown at 40%
      await t.w.check();
      assert.strictEqual(t.asked.length, 1);
      await t.w.check();
      assert.strictEqual(t.asked.length, 1);
      t.state.live = { grid: grid(300, 300, 400), state: state({ sidebar: 500 }) };
      await t.w.check();
      assert.strictEqual(t.asked.length, 2);
    });

    test('a baseline that measured everything still silences a window that has not moved since', async () => {
      const t = watch({ answer: 'Not now' });
      t.state.live = drifted();
      await t.w.settle();
      await t.w.check();
      assert.deepStrictEqual(t.asked, []);
    });

    test('asks once when a proportion moved, with the three buttons', async () => {
      const t = watch({ answer: 'Not now' });
      t.state.live = drifted();
      await t.w.check();
      assert.strictEqual(t.asked.length, 1);
      assert.strictEqual(t.asked[0].message, 'Your layout has changed since you saved it.');
      assert.deepStrictEqual(t.asked[0].buttons, ['Save this layout', 'Restore saved layout', 'Not now']);
    });

    test('when the shape changed, Save this layout becomes Edit layout…', async () => {
      const t = watch({ answer: 'Not now' });
      t.state.live = { grid: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] }, state: state() };
      await t.w.check();
      assert.deepStrictEqual(t.asked[0].buttons, ['Edit layout…', 'Restore saved layout', 'Not now']);
    });

    test('never asks while hyperspace is on, the page is open, an apply is running, or no layout is saved', async () => {
      const blocked = watch({ blocked: true });
      blocked.state.live = drifted();
      await blocked.w.check();
      const none = watch({ saved: undefined });
      none.state.live = drifted();
      await none.w.check();
      assert.deepStrictEqual([blocked.asked, none.asked], [[], []]);
    });

    test('Save this layout saves what is on screen, and the window is then quiet', async () => {
      const t = watch({ answer: 'Save this layout' });
      t.state.live = drifted();
      await t.w.check();
      assert.deepStrictEqual(t.done, ['save']);
      assert.deepStrictEqual(t.savedLayout()!.grid!.groups.map((g) => g.size), [0.34, 0.26, 0.4]);
    });

    test('Save this layout saves what is on screen when it is pressed, not when the message appeared', async () => {
      const t = watch({ answer: 'Save this layout', during: () => (t.state.live = { grid: grid(800, 200, 400), state: state() }) });
      t.state.live = { grid: grid(600, 400, 400), state: state() };
      await t.w.check();
      assert.deepStrictEqual(t.savedLayout()!.grid!.groups.map((g) => g.size), [800 / 1400, 200 / 1400, 400 / 1400]);
    });

    test('Save this layout keeps the agents and terminals as saved when it is pressed, not as they were when the message appeared', async () => {
      const t = watch({
        answer: 'Save this layout',
        during: () => (t.state.saved = { ...saved(), agents: { claudeCode: 'column', codex: 'panel' } }),
      });
      t.state.live = drifted();
      await t.w.check();
      assert.deepStrictEqual(t.savedLayout()!.agents, { claudeCode: 'column', codex: 'panel' });
    });

    test('Save this layout keeps what another window saved after the window was read, and only measures proportions', async () => {
      const t = watch({
        answer: 'Save this layout',
        beforeWrite: () => (t.state.saved = { ...saved(), agents: { claudeCode: 'column', codex: 'panel' } }),
      });
      t.state.live = drifted();
      await t.w.check();
      assert.deepStrictEqual(t.savedLayout()!.agents, { claudeCode: 'column', codex: 'panel' });
      assert.deepStrictEqual(t.savedLayout()!.grid!.groups.map((g) => g.size), [0.34, 0.26, 0.4]);
    });

    test('Save this layout saves nothing if another window changed the columns before the write', async () => {
      const t = watch({
        answer: 'Save this layout',
        beforeWrite: () => (t.state.saved = { ...saved(), grid: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] } }),
      });
      t.state.live = drifted();
      await t.w.check();
      assert.deepStrictEqual(t.done, []);
      assert.strictEqual(t.told.length, 1);
    });

    test('Save this layout saves nothing if the window went back to the saved layout while the message was open', async () => {
      const t = watch({ answer: 'Save this layout', during: () => (t.state.live = exact()) });
      t.state.live = drifted();
      await t.w.check();
      assert.deepStrictEqual(t.done, []);
    });

    test('Save this layout saves nothing, and says so, if the columns changed shape while the message was open', async () => {
      const t = watch({
        answer: 'Save this layout',
        during: () => (t.state.live = { grid: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] }, state: state() }),
      });
      t.state.live = drifted();
      await t.w.check();
      assert.deepStrictEqual(t.done, []);
      assert.strictEqual(t.told.length, 1);
    });

    test('Save this layout saves nothing if hyperspace, a restore or the page started while the message was open', async () => {
      const t = watch({ answer: 'Save this layout', during: () => (t.state.blocked = true) });
      t.state.live = drifted();
      await t.w.check();
      assert.deepStrictEqual(t.done, []);
    });

    test('Not now stays quiet about the window as it is when the message is answered', async () => {
      const t = watch({ answer: 'Not now', during: () => (t.state.live = { grid: grid(800, 200, 400), state: state() }) });
      t.state.live = drifted();
      await t.w.check();
      await t.w.check();
      assert.strictEqual(t.asked.length, 1);
    });

    test('Save this layout that fails tells the person, and the prompt can come back', async () => {
      const t = watch({ answer: 'Save this layout', failSave: true });
      t.state.live = drifted();
      await t.w.check();
      assert.strictEqual(t.told.length, 1);
      assert.match(t.told[0], /settings are busy/);
    });

    test('Restore saved layout restores', async () => {
      const t = watch({ answer: 'Restore saved layout' });
      t.state.live = drifted();
      await t.w.check();
      assert.deepStrictEqual(t.done, ['restore']);
    });

    test('Edit layout… opens the page', async () => {
      const t = watch({ answer: 'Edit layout…' });
      t.state.live = { grid: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] }, state: state() };
      await t.w.check();
      assert.deepStrictEqual(t.done, ['edit']);
    });

    test('Not now, or closing the message, stays quiet until the window changes again', async () => {
      for (const answer of ['Not now', undefined]) {
        const t = watch({ answer });
        t.state.live = drifted();
        await t.w.check();
        await t.w.check();
        await t.w.check();
        assert.strictEqual(t.asked.length, 1, String(answer));
        t.state.live = { grid: grid(400, 200, 400), state: state() }; // moved again
        await t.w.check();
        assert.strictEqual(t.asked.length, 2, String(answer));
      }
    });

    test('after Not now, coming back to the saved layout and drifting again asks again', async () => {
      const t = watch({ answer: 'Not now' });
      t.state.live = drifted();
      await t.w.check();
      t.state.live = exact();
      await t.w.check();
      t.state.live = drifted();
      await t.w.check();
      assert.strictEqual(t.asked.length, 2);
    });

    test('a window that an apply left a little off is quiet: settling after an apply counts as Not now', async () => {
      const t = watch();
      t.state.live = drifted(); // what VS Code gave after the apply
      await t.w.settle();
      await t.w.check();
      assert.deepStrictEqual(t.asked, []);
      t.state.live = { grid: grid(400, 200, 400), state: state() };
      await t.w.check();
      assert.strictEqual(t.asked.length, 1);
    });

    test('does not ask twice at once while the first message is still open', async () => {
      let answer!: (choice: string) => void;
      const t = watch({ hold: new Promise<string>((resolve) => (answer = resolve)) });
      t.state.live = drifted();
      const first = t.w.check();
      await t.w.check();
      assert.strictEqual(t.asked.length, 1);
      answer('Not now');
      await first;
    });

    test('a failing read is logged and is not an error', async () => {
      const t = watch({ failRead: true });
      await t.w.check();
      assert.deepStrictEqual(t.asked, []);
    });
  });

  suite('reading the window', () => {
    const reads = (over: Partial<LiveReads>): LiveReads => ({
      layout: async () => ({ orientation: 0, groups: [{ size: 80 }, { size: 20 }] }),
      state: async () => ({
        window: { width: 1000, height: 800 },
        panelPosition: 'bottom',
        parts: { sidebar: { visible: true, size: 300 }, auxiliarybar: { visible: true, size: 300 }, panel: { visible: true, size: 200 } },
      }),
      mainLayout: async () => {
        throw new Error('no such command');
      },
      allGroups: () => 2,
      ...over,
    });

    test("with no other editor window the grid is the main window's, and is kept", async () => {
      const live = await readLive(reads({}));
      assert.strictEqual(live.grid?.groups.length, 2);
      assert.ok(live.state);
    });

    test('with another editor window open the grid is left out, even when it has as many groups as the main window', async () => {
      // The active window is a floating one with two 80/20 columns; the main window has two groups as well.
      const live = await readLive(reads({ allGroups: () => 4 }));
      assert.strictEqual(live.grid, undefined);
      assert.ok(live.state); // the sizes come from the main window, whichever window has focus
    });

    test('a window that opens while the grid is being read invalidates that read', async () => {
      // One window with two groups when the read starts; a floating window with two groups opens (and is active) before it answers.
      let total = 2;
      const live = await readLive(
        reads({
          allGroups: () => total,
          layout: async () => {
            total = 4;
            return { orientation: 0, groups: [{ size: 80 }, { size: 20 }] };
          },
        }),
      );
      assert.strictEqual(live.grid, undefined);
      assert.ok(live.state);
    });

    test('without the core bridge a single editor window still has its grid compared; the sizes are left out', async () => {
      const live = await readLive(reads({ state: async () => { throw new Error('no such command'); } }));
      assert.strictEqual(live.grid?.groups.length, 2);
      assert.strictEqual(live.state, undefined);
    });

    test("with the core bridge the main window's grid is read even while a floating window is open and active", async () => {
      const live = await readLive(
        reads({
          allGroups: () => 4,
          layout: async () => ({ orientation: 0, groups: [{ size: 10 }, { size: 90 }] }), // the floating window's, never asked for
          mainLayout: async () => ({ orientation: 0, groups: [{ size: 50 }, { size: 50 }] }),
        }),
      );
      assert.strictEqual(live.grid?.groups.length, 2);
      assert.strictEqual(live.grid?.groups[0].size, 50);
    });

    test('with the core bridge the grid does not depend on the window counts, so nothing opening mid-read can change it', async () => {
      let total = 2;
      const live = await readLive(
        reads({
          allGroups: () => total,
          mainLayout: async () => {
            total = 4;
            return { orientation: 0, groups: [{ size: 80 }, { size: 20 }] };
          },
        }),
      );
      assert.strictEqual(live.grid?.groups[0].size, 80);
    });

    test('a grid with more groups than the window total is not trusted either', async () => {
      const live = await readLive(reads({ allGroups: () => 1 }));
      assert.strictEqual(live.grid, undefined);
    });
  });

  suite('checking while the window has focus', () => {
    function window(focused: boolean) {
      let onChange: (focused: boolean) => void = () => undefined;
      let ticks: (() => void) | undefined;
      let cleared = 0;
      const checks: string[] = [];
      const win = {
        focused,
        onDidChange: (fn: (focused: boolean) => void) => {
          onChange = fn;
          return { dispose: () => undefined };
        },
      };
      const timers = {
        every: (fn: () => void, ms: number) => {
          assert.strictEqual(ms, 30000);
          ticks = fn;
          return () => {
            cleared++;
            ticks = undefined;
          };
        },
      };
      runWhileFocused(win, () => void checks.push('check'), timers);
      return { checks, focus: (f: boolean) => onChange(f), tick: () => ticks?.(), running: () => ticks !== undefined, cleared: () => cleared };
    }

    test('checks when the window gains focus and every 30 seconds while it has it', () => {
      const w = window(false);
      assert.deepStrictEqual(w.checks, []);
      assert.strictEqual(w.running(), false);
      w.focus(true);
      assert.strictEqual(w.checks.length, 1);
      w.tick();
      w.tick();
      assert.strictEqual(w.checks.length, 3);
    });

    test('starts checking at once if the window already has focus, and stops when it loses it', () => {
      const w = window(true);
      assert.strictEqual(w.checks.length, 1);
      w.focus(false);
      assert.strictEqual(w.running(), false);
      assert.strictEqual(w.cleared(), 1);
      w.focus(true);
      assert.strictEqual(w.running(), true);
    });
  });
});

suite('drift save, with the real settings and a save record on disk', () => {
  const layout = () => vscode.workspace.getConfiguration('towelwise.layout');
  const GLOBAL = vscode.ConfigurationTarget.Global;
  let dir: string;
  setup(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-drift-'));
    keepLayoutRecordIn(dir);
  });
  teardown(async () => {
    keepLayoutRecordIn(undefined);
    for (const key of ['agents', 'grid', 'sizes']) await layout().update(key, undefined, GLOBAL);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a save left half done by another window is put right before Save this layout decides, so its values are not saved again', async () => {
    // Codex was on the left; a save that moved it right failed after writing agents, and its record keeps the originals.
    await layout().update('agents', { codex: 'right' }, GLOBAL);
    await layout().update('sizes', { sidebar: 0.2 }, GLOBAL);
    fs.writeFileSync(
      layoutRecordPath(dir),
      JSON.stringify({
        before: { agents: { had: true, value: { codex: 'left' } }, grid: { had: false }, sizes: { had: true, value: { sidebar: 0.2 } } },
        after: { agents: { codex: 'right' }, grid: {}, sizes: { sidebar: 0.3 } },
      }),
    );
    const seen: unknown[] = [];
    await liveDriftHost(dir, {} as vscode.ExtensionContext, () => undefined).save((saved) => {
      seen.push(saved.agents);
      return { ...saved, sizes: { sidebar: 0.25 } };
    });
    assert.deepStrictEqual(seen, [{ codex: 'left' }], 'the decision is made on the settings as recovered');
    assert.deepStrictEqual(layout().inspect('agents')?.globalValue, { codex: 'left' });
    assert.deepStrictEqual(layout().inspect('sizes')?.globalValue, { sidebar: 0.25 });
    assert.ok(!fs.existsSync(layoutRecordPath(dir)));
  });
});
