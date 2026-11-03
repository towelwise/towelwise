import * as assert from 'node:assert';
import { coreContainerId, parseAgents } from '../agents';
import { applyLayout, locationFor, MyLayoutHost } from '../myLayout';
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
      assert.deepStrictEqual(parseAgents({ claudeCode: 'editor', codex: 'right' }, noLog), { claudeCode: 'editor', codex: 'right' });
      assert.deepStrictEqual(parseAgents({ codex: 'panel' }, noLog), { codex: 'panel' });
    });

    test('nothing set gives no layout and no log line', () => {
      const logs: string[] = [];
      for (const empty of [undefined, {}]) assert.strictEqual(parseAgents(empty, (l) => logs.push(l)), undefined);
      assert.deepStrictEqual(logs, []);
    });

    test('a value that does not fit is ignored as a whole and logged', () => {
      const logs: string[] = [];
      for (const bad of [5, 'x', [], { codex: 'middle' }, { cline: 'left' }, { codex: 'left', claudeCode: 3 }]) {
        assert.strictEqual(parseAgents(bad, (l) => logs.push(l)), undefined, JSON.stringify(bad));
      }
      assert.strictEqual(logs.length, 6);
    });
  });

  suite('locationFor', () => {
    test('left and right follow the side the primary side bar is on', () => {
      assert.strictEqual(locationFor('left', false), 'sidebar');
      assert.strictEqual(locationFor('right', false), 'auxiliarybar');
      assert.strictEqual(locationFor('left', true), 'auxiliarybar');
      assert.strictEqual(locationFor('right', true), 'sidebar');
      assert.strictEqual(locationFor('panel', true), 'panel');
      assert.strictEqual(locationFor('editor', false), undefined);
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
      assert.deepStrictEqual(out, { placed: ['codex'], problems: [] });
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

    test('an agent placed in the editor is left for the grid slice and reported', async () => {
      const w = windowWith({ [CODEX]: 'auxiliarybar' });
      const out = await applyLayout(w.host, { agents: { codex: 'editor' } });
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
      assert.deepStrictEqual(out, { placed: [], problems: [], refused: 'hyperspace' });
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
});
