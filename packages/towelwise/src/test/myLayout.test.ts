import * as assert from 'node:assert';
import { AgentId, coreContainerId, parseAgents } from '../agents';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { applyLayout, applyLayoutLocked, applyLayoutOnStartup, liveHost, MyLayoutHost, Outcome, reportOutcome } from '../myLayout';
import { agentsByPart, layoutInUse, locationFor } from '../savedLayout';
import { LayoutState } from '../sizes';

const noLog = () => undefined;

const liveState = (): LayoutState => ({
  window: { width: 1000, height: 800 },
  panelPosition: 'bottom',
  parts: {
    sidebar: { visible: true, size: 300, container: { id: 'explorer', title: 'Explorer' } },
    auxiliarybar: { visible: true, size: 300 },
    panel: { visible: true, size: 200 },
  },
});

// A window that knows where each container lives and records everything asked of it.
function windowWith(
  containers: Record<string, string>,
  opts: {
    sideBarOnRight?: boolean;
    hyperspace?: boolean;
    failMove?: string[];
    failRun?: string[];
    refuseMove?: boolean;
    failState?: 'throws' | 'empty';
    failSetSize?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const logs: string[] = [];
  const told: string[] = [];
  const where = { ...containers };
  const host: MyLayoutHost = {
    planTerminal: async (t) => ({ open: { name: t.name ?? 'Terminal' }, problems: [] }),
    sideBarOnRight: opts.sideBarOnRight ?? false,
    hyperspaceActive: () => opts.hyperspace ?? false,
    run: async (command) => {
      calls.push(`run ${command}`);
      if (opts.failRun?.includes(command)) throw new Error('no such command');
    },
    bridge: {
      state: async () => {
        if (opts.failState === 'throws') throw new Error('bridge gone');
        return opts.failState === 'empty' ? undefined : liveState();
      },
      setSize: async (part, pixels) => {
        calls.push(`size ${part} ${pixels}`);
        if (opts.failSetSize) throw new Error('no room');
        return pixels;
      },
      locate: async (id) => where[id],
      moveContainer: async (id, location) => {
        calls.push(`move ${id} ${location}`);
        if (opts.failMove?.includes(id)) throw new Error('boom');
        if (opts.refuseMove) return false;
        where[id] = location;
        return true;
      },
    },
    log: (line) => logs.push(line),
    tell: (message) => told.push(message),
  };
  return { host, calls, logs, told, where };
}

suite('agents and my layout', () => {
  suite('parseAgents', () => {
    test('accepts a place for each known agent', () => {
      assert.deepStrictEqual(parseAgents({ claudeCode: 'column', codex: 'right' }, noLog), { claudeCode: 'column', codex: 'right' });
      assert.deepStrictEqual(parseAgents({ codex: 'panel' }, noLog), { codex: 'panel' });
    });

    test('nothing set gives no layout and no log line', () => {
      const logs: string[] = [];
      for (const empty of [undefined, {}]) assert.strictEqual(parseAgents(empty, (l) => logs.push(l)), undefined);
      assert.deepStrictEqual(logs, []);
    });

    test('a value that does not fit is ignored as a whole and logged', () => {
      const logs: string[] = [];
      for (const bad of [5, 'x', [], { codex: 'middle' }, { codex: 'editor' }, { cline: 'left' }, { codex: 'left', claudeCode: 3 }]) {
        assert.strictEqual(parseAgents(bad, (l) => logs.push(l)), undefined, JSON.stringify(bad));
      }
      assert.strictEqual(logs.length, 7);
    });
  });

  suite('locationFor', () => {
    test('left and right follow the side the primary side bar is on', () => {
      assert.strictEqual(locationFor('left', false), 'sidebar');
      assert.strictEqual(locationFor('right', false), 'auxiliarybar');
      assert.strictEqual(locationFor('left', true), 'auxiliarybar');
      assert.strictEqual(locationFor('right', true), 'sidebar');
      assert.strictEqual(locationFor('panel', true), 'panel');
      assert.strictEqual(locationFor('column', false), undefined);
    });
  });

  suite('agentsByPart', () => {
    const none = { sidebar: [], auxiliarybar: [], panel: [] };

    test('an agent lives in the part its place names, on either side of the window', () => {
      const agents = { claudeCode: 'left', codex: 'right' } as const;
      assert.deepStrictEqual(agentsByPart({ agents }, false), { sidebar: ['claudeCode'], auxiliarybar: ['codex'], panel: [] });
      assert.deepStrictEqual(agentsByPart({ agents }, true), { sidebar: ['codex'], auxiliarybar: ['claudeCode'], panel: [] });
    });

    test('an agent on the panel puts the panel in use', () => {
      assert.deepStrictEqual(agentsByPart({ agents: { codex: 'panel' } }, false), { ...none, panel: ['codex'] });
    });

    test('two agents in one part are both named', () => {
      assert.deepStrictEqual(agentsByPart({ agents: { claudeCode: 'right', codex: 'right' } }, false), { ...none, auxiliarybar: ['claudeCode', 'codex'] });
    });

    test('a column agent, a grid or sizes alone, and no layout leave every part unused', () => {
      assert.deepStrictEqual(agentsByPart({ agents: { codex: 'column' } }, false), none);
      assert.deepStrictEqual(agentsByPart({ sizes: { sidebar: 0.2 } }, false), none);
      assert.deepStrictEqual(agentsByPart({ grid: { orientation: 0, groups: [{ size: 1, holds: 'terminal' }] } }, false), none);
      assert.deepStrictEqual(agentsByPart(undefined, false), none);
    });
  });

  suite('applyLayout', () => {
    // Core names an extension's container by prefixing the id its manifest declares.
    const CODEX = coreContainerId('codexSecondaryViewContainer');
    const CLAUDE = coreContainerId('claude-sidebar-secondary');

    test('moves a view that is somewhere else, then opens it with the agent\'s own command', async () => {
      const w = windowWith({ [CODEX]: 'auxiliarybar' });
      const out = await applyLayout(w.host, { agents: { codex: 'left' } });
      assert.deepStrictEqual(w.calls, [`move ${CODEX} sidebar`, 'run chatgpt.openSidebar']);
      assert.deepStrictEqual(out, { placed: ['codex'], problems: [], openAsTab: [] });
    });

    test('asks the window about the ids core really uses: the manifest id with a prefix', async () => {
      assert.strictEqual(coreContainerId('codexSecondaryViewContainer'), 'workbench.view.extension.codexSecondaryViewContainer');
      const w = windowWith({ 'workbench.view.extension.codexSecondaryViewContainer': 'auxiliarybar' });
      await applyLayout(w.host, { agents: { codex: 'left' } });
      assert.deepStrictEqual(w.calls, ['move workbench.view.extension.codexSecondaryViewContainer sidebar', 'run chatgpt.openSidebar']);
      // A window that only knows the bare manifest id has no such container.
      const bare = windowWith({ codexSecondaryViewContainer: 'auxiliarybar' });
      const out = await applyLayout(bare.host, { agents: { codex: 'left' } });
      assert.deepStrictEqual(bare.calls, []);
      assert.strictEqual(out.problems.length, 1);
    });

    test('a view that is already in place is not moved, but is still opened', async () => {
      const w = windowWith({ [CODEX]: 'auxiliarybar' });
      await applyLayout(w.host, { agents: { codex: 'right' } });
      assert.deepStrictEqual(w.calls, ['run chatgpt.openSidebar']);
    });

    test('left and right swap when the side bar is on the right', async () => {
      const w = windowWith({ [CODEX]: 'auxiliarybar' }, { sideBarOnRight: true });
      await applyLayout(w.host, { agents: { codex: 'left' } });
      assert.deepStrictEqual(w.calls, ['run chatgpt.openSidebar']);
    });

    test('the bottom panel is a place like the others', async () => {
      const w = windowWith({ [CLAUDE]: 'auxiliarybar' });
      await applyLayout(w.host, { agents: { claudeCode: 'panel' } });
      assert.deepStrictEqual(w.calls, [`move ${CLAUDE} panel`, 'run claude-vscode.sidebar.open']);
    });

    test('uses whichever of an agent\'s containers the window has', async () => {
      const w = windowWith({ [coreContainerId('claude-sidebar')]: 'sidebar' });
      await applyLayout(w.host, { agents: { claudeCode: 'right' } });
      assert.deepStrictEqual(w.calls, [`move ${coreContainerId('claude-sidebar')} auxiliarybar`, 'run claude-vscode.sidebar.open']);
    });

    test('an agent the window does not have is reported, and nothing is run for it', async () => {
      const w = windowWith({ [CODEX]: 'auxiliarybar' });
      const out = await applyLayout(w.host, { agents: { claudeCode: 'left', codex: 'right' } });
      assert.deepStrictEqual(w.calls, ['run chatgpt.openSidebar']);
      assert.deepStrictEqual(out.placed, ['codex']);
      assert.strictEqual(out.problems.length, 1);
      assert.match(out.problems[0], /Claude Code/);
    });

    test('a move that fails or is refused is reported and the agent is still opened', async () => {
      for (const opts of [{ failMove: [CODEX] }, { refuseMove: true }]) {
        const w = windowWith({ [CODEX]: 'auxiliarybar' }, opts);
        const out = await applyLayout(w.host, { agents: { codex: 'left' } });
        assert.deepStrictEqual(w.calls, [`move ${CODEX} sidebar`, 'run chatgpt.openSidebar'], JSON.stringify(opts));
        assert.deepStrictEqual(out.placed, [], JSON.stringify(opts));
        assert.strictEqual(out.problems.length, 1, JSON.stringify(opts));
      }
    });

    test('one agent failing does not stop the next', async () => {
      const w = windowWith({ [CODEX]: 'auxiliarybar', [CLAUDE]: 'auxiliarybar' }, { failRun: ['claude-vscode.sidebar.open'] });
      const out = await applyLayout(w.host, { agents: { claudeCode: 'left', codex: 'panel' } });
      assert.ok(w.calls.includes('run chatgpt.openSidebar'));
      assert.deepStrictEqual(out.placed, ['codex']);
      assert.strictEqual(out.problems.length, 1);
    });

    test('an agent placed in a column with no grid saved is reported, and nothing is run', async () => {
      const w = windowWith({ [CODEX]: 'auxiliarybar' });
      const out = await applyLayout(w.host, { agents: { codex: 'column' } });
      assert.deepStrictEqual(w.calls, []);
      assert.deepStrictEqual(out.placed, []);
      assert.strictEqual(out.problems.length, 1);
    });

    test('sizes are set last, after the views are in place', async () => {
      const w = windowWith({ [CODEX]: 'auxiliarybar' });
      await applyLayout(w.host, { agents: { codex: 'left' }, sizes: { sidebar: 0.2, panel: 0.25, panelOrientation: 'down' } });
      assert.deepStrictEqual(w.calls, [`move ${CODEX} sidebar`, 'run chatgpt.openSidebar', 'size sidebar 200', 'size panel 200']);
    });

    test('sizes alone are applied when no agent is placed', async () => {
      const w = windowWith({});
      await applyLayout(w.host, { sizes: { sidebar: 0.4 } });
      assert.deepStrictEqual(w.calls, ['size sidebar 400']);
    });

    test('is refused, and does nothing, while hyperspace is on', async () => {
      const w = windowWith({ [CODEX]: 'auxiliarybar' }, { hyperspace: true });
      const out = await applyLayout(w.host, { agents: { codex: 'left' }, sizes: { sidebar: 0.4 } });
      assert.deepStrictEqual(w.calls, []);
      assert.deepStrictEqual(out, { placed: [], problems: [], openAsTab: [], refused: 'hyperspace' });
    });

    test('running it twice leaves the same result', async () => {
      const w = windowWith({ [CODEX]: 'auxiliarybar' });
      await applyLayout(w.host, { agents: { codex: 'left' } });
      const first = w.calls.length;
      await applyLayout(w.host, { agents: { codex: 'left' } });
      // The second run has nothing to move, only the open command again.
      assert.deepStrictEqual(w.calls.slice(first), ['run chatgpt.openSidebar']);
      assert.strictEqual(w.where[CODEX], 'sidebar');
    });

    test('sizes that cannot be read or set are reported, and the agents are still placed', async () => {
      for (const opts of [{ failState: 'throws' as const }, { failState: 'empty' as const }, { failSetSize: true }]) {
        const w = windowWith({ [CODEX]: 'auxiliarybar' }, opts);
        const out = await applyLayout(w.host, { agents: { codex: 'left' }, sizes: { sidebar: 0.2 } });
        assert.deepStrictEqual(out.placed, ['codex'], JSON.stringify(opts));
        assert.strictEqual(out.problems.length, 1, JSON.stringify(opts));
        assert.match(out.problems[0], /^sizes:/, JSON.stringify(opts));
        assert.ok(w.logs.some((l) => l.startsWith('layout: sizes:')), JSON.stringify(opts));
      }
    });

    test('a panel on a different side than when its size was saved is reported, once', async () => {
      const w = windowWith({});
      const out = await applyLayout(w.host, { sizes: { panel: 0.3, panelOrientation: 'across' } });
      assert.deepStrictEqual(w.calls, []);
      assert.strictEqual(out.problems.length, 1);
      assert.deepStrictEqual(w.told, []);
    });
  });

  suite('one restore at a time', () => {
    test('a restore that starts while another is running is told it is busy and does nothing; one after it works', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'towelwise-'));
      const core = coreContainerId('codexSecondaryViewContainer');
      const first = windowWith({ [core]: 'auxiliarybar' });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const running = applyLayoutLocked(dir, { ...first.host, run: async () => gate }, { agents: { codex: 'left' } });
      const second = windowWith({ [core]: 'auxiliarybar' });
      assert.strictEqual(await applyLayoutLocked(dir, second.host, { agents: { codex: 'left' } }), 'busy');
      assert.deepStrictEqual(second.calls, []);
      release();
      assert.notStrictEqual(await running, 'busy');
      const third = windowWith({ [core]: 'auxiliarybar' });
      assert.notStrictEqual(await applyLayoutLocked(dir, third.host, { agents: { codex: 'left' } }), 'busy');
      assert.ok(third.calls.length > 0);
    });
  });

  suite('the live host in a project that is not trusted', () => {
    const real = Object.getOwnPropertyDescriptor(vscode.workspace, 'isTrusted');
    const trust = (value: boolean) => Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => value, configurable: true });
    teardown(() => (real ? Object.defineProperty(vscode.workspace, 'isTrusted', real) : delete (vscode.workspace as { isTrusted?: boolean }).isTrusted));

    test('trust granted while a restore is running does not run its startup commands; the next restore does (decision 0006)', async function () {
      this.timeout(10000); // the first terminal asks WSL for its distributions
      const web = { name: 'Web', command: 'npm run dev' };
      trust(false);
      const restore = liveHost(os.tmpdir(), noLog);
      trust(true);
      const planned = await restore.planTerminal(web);
      assert.strictEqual(planned.open.command, undefined);
      assert.strictEqual(planned.problems.length, 1);
      assert.strictEqual((await liveHost(os.tmpdir(), noLog).planTerminal(web)).open.command, 'npm run dev');
    });
  });

  suite('applying the layout when a window opens', () => {
    const SETTING = 'towelwise.layout.applyOnStartup';
    const core = coreContainerId('codexSecondaryViewContainer');
    const mine = { agents: { codex: 'left' } } as const;
    let dir: string;

    setup(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'towelwise-'));
    });
    teardown(async () => {
      await vscode.workspace.getConfiguration().update(SETTING, undefined, vscode.ConfigurationTarget.Global);
    });

    test('is on unless the person turns it off, and then applies the saved layout', async () => {
      const w = windowWith({ [core]: 'auxiliarybar' });
      assert.strictEqual(await applyLayoutOnStartup(dir, w.host, mine), true);
      assert.ok(w.calls.includes(`move ${core} sidebar`));
    });

    test('does nothing when the setting is off', async () => {
      await vscode.workspace.getConfiguration().update(SETTING, false, vscode.ConfigurationTarget.Global);
      const w = windowWith({ [core]: 'auxiliarybar' });
      assert.strictEqual(await applyLayoutOnStartup(dir, w.host, mine), false);
      assert.deepStrictEqual(w.calls, []);
    });

    test('does nothing while hyperspace is on, and says so in the log', async () => {
      const w = windowWith({ [core]: 'auxiliarybar' }, { hyperspace: true });
      assert.strictEqual(await applyLayoutOnStartup(dir, w.host, mine), false);
      assert.deepStrictEqual(w.calls, []);
      assert.ok(w.logs.some((l) => /hyperspace/.test(l)));
    });

    test('does nothing while another window is restoring, and says so in the log', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const first = windowWith({ [core]: 'auxiliarybar' });
      const running = applyLayoutLocked(dir, { ...first.host, run: async () => gate }, mine);
      const second = windowWith({ [core]: 'auxiliarybar' });
      assert.strictEqual(await applyLayoutOnStartup(dir, second.host, mine), false);
      assert.deepStrictEqual(second.calls, []);
      assert.ok(second.logs.some((l) => /another/.test(l)));
      release();
      await running;
    });

    test('hands what could not be placed, and the second copies open as tabs, to the same report Restore Layout gives', async () => {
      const w = windowWith({}); // the agent is not installed
      const reported: Outcome[] = [];
      assert.strictEqual(await applyLayoutOnStartup(dir, w.host, mine, (outcome) => void reported.push(outcome)), true);
      assert.strictEqual(reported.length, 1);
      assert.ok(reported[0].problems.some((p) => /Codex/.test(p)));
    });

    test('reports nothing when it did not apply', async () => {
      const reported: Outcome[] = [];
      const report = (outcome: Outcome) => void reported.push(outcome);
      await vscode.workspace.getConfiguration().update(SETTING, false, vscode.ConfigurationTarget.Global);
      await applyLayoutOnStartup(dir, windowWith({}).host, mine, report);
      await vscode.workspace.getConfiguration().update(SETTING, undefined, vscode.ConfigurationTarget.Global);
      await applyLayoutOnStartup(dir, windowWith({}, { hyperspace: true }).host, mine, report);
      assert.deepStrictEqual(reported, []);
    });
  });

  suite('reporting what was applied', () => {
    const outcome = (over: Partial<Outcome> = {}): Outcome => ({ placed: [], problems: [], openAsTab: [], ...over });
    function ui(press = false) {
      const told: string[] = [];
      const offers: { message: string; button: string }[] = [];
      return {
        told,
        offers,
        ui: {
          tell: (m: string) => void told.push(m),
          offer: async (message: string, button: string) => (offers.push({ message, button }), press),
        },
      };
    }

    test('says nothing when everything was placed', async () => {
      const u = ui();
      await reportOutcome(outcome({ placed: ['codex'] }), u.ui, async () => undefined);
      assert.deepStrictEqual([u.told, u.offers], [[], []]);
    });

    test('names what could not be placed', async () => {
      const u = ui();
      await reportOutcome(outcome({ problems: ['Codex: not installed or not available in this window', 'sizes: no room'] }), u.ui, async () => undefined);
      assert.deepStrictEqual(u.told, ['Towelwise: your layout is applied, except: Codex: not installed or not available in this window; sizes: no room.']);
    });

    test('tells the person to leave hyperspace first', async () => {
      const u = ui();
      await reportOutcome(outcome({ refused: 'hyperspace' }), u.ui, async () => undefined);
      assert.deepStrictEqual(u.told, ['Towelwise: leave hyperspace first, then restore your layout.']);
    });

    test('offers to close a second copy open as a tab, and closes it only when the button is pressed', async () => {
      const closed: AgentId[] = [];
      const idle = ui(false);
      await reportOutcome(outcome({ openAsTab: ['claudeCode'] }), idle.ui, async (ids) => void closed.push(...ids));
      assert.deepStrictEqual(idle.offers, [{ message: 'Towelwise: Claude Code also opens as an editor tab.', button: 'Close it' }]);
      assert.deepStrictEqual(closed, []);

      const pressed = ui(true);
      const closedNow: AgentId[] = [];
      await reportOutcome(outcome({ openAsTab: ['claudeCode', 'codex'] }), pressed.ui, async (ids) => void closedNow.push(...ids));
      assert.strictEqual(pressed.offers[0].message, 'Towelwise: Claude Code and Codex also open as an editor tab.');
      assert.deepStrictEqual(closedNow, ['claudeCode', 'codex']);
    });

    test('a tab of that agent opening or closing while the report is open means the button closes nothing, and says so', async () => {
      let change = (): void => undefined;
      let disposed = 0;
      const watched: (readonly AgentId[])[] = [];
      const watch = (agents: readonly AgentId[], onChange: () => void) => {
        watched.push(agents);
        change = onChange;
        return { dispose: () => void disposed++ };
      };
      let press!: (pressed: boolean) => void;
      const told: string[] = [];
      const closed: AgentId[] = [];
      const reporting = reportOutcome(
        outcome({ openAsTab: ['codex'] }),
        { tell: (m) => void told.push(m), offer: () => new Promise<boolean>((resolve) => (press = resolve)) },
        async (ids) => void closed.push(...ids),
        watch,
      );
      change(); // a new Codex conversation opens, and it may hold an unsent draft
      press(true);
      await reporting;
      assert.deepStrictEqual(closed, []);
      assert.match(told[0], /out of date/);
      assert.deepStrictEqual(watched, [['codex']]);
      assert.strictEqual(disposed, 1, 'the watch ends with the offer');
    });
  });

  suite('layoutInUse', () => {
    test('a layout is in use when agents, a grid or sizes are saved, so a terminal-only grid or sizes alone are applied', () => {
      assert.strictEqual(layoutInUse({ agents: { codex: 'left' } }), true);
      assert.strictEqual(layoutInUse({ grid: { orientation: 0, groups: [{ size: 1, holds: 'terminal' }] } }), true);
      assert.strictEqual(layoutInUse({ sizes: { sidebar: 0.2 } }), true);
    });

    test('nothing saved leaves the earlier container list in charge', () => {
      assert.strictEqual(layoutInUse({}), false);
      assert.strictEqual(layoutInUse({ sizes: {} }), false);
    });
  });
});
