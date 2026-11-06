import * as assert from 'node:assert';
import { AGENTS, Holds, coreContainerId, holdsOfTab } from '../agents';
import { CellTerminal, TerminalOpen, terminalName } from '../cellTerminal';
import { Column, toSavedGrid } from '../columns';
import { Layout } from '../grid';
import { Editors, MyLayout, MyLayoutHost, applyLayout, closeAgentTabs, reportOutcome } from '../myLayout';
import { LayoutState } from '../sizes';

interface Tab {
  holds?: Holds;
  label: string;
  // A revived terminal's name, which VS Code restores a moment after its tab is there: the label is empty until settled() runs.
  arrives?: string;
}
// held: the group has held a tab at some time. VS Code closes a group when its last tab leaves, but a group that never
// held one (an empty cell the grid just created) stays; the probe on 2026-11-03 showed both.
interface Group {
  tabs: Tab[];
  held: boolean;
}

const leaves = (layout: Layout): number => {
  const count = (nodes: { groups?: unknown[] }[]): number =>
    nodes.reduce((n, node) => n + (node.groups ? count(node.groups as { groups?: unknown[] }[]) : 1), 0);
  return count(layout.groups);
};

const tab = (holds?: Holds, label?: string): Tab => ({ holds, label: label ?? holds ?? 'file' });

// An editor area that behaves as the probes showed: setEditorLayout grows or merges groups, Claude Code opens in a group
// of its own beside the first, Codex opens in the focused group, a terminal goes where it is asked, empty groups that
// held a tab close.
function editorWindow(
  opts: {
    start?: Tab[][];
    claudeOpens?: boolean;
    codexOpens?: boolean;
    gridIgnored?: boolean;
    gridFails?: boolean;
    keepIgnored?: boolean;
    // What the host's planTerminal reports as falling back, for every terminal.
    terminalProblems?: string[];
    // Groups in other editor windows (the Choose Layout page's, a floating file's). The grid never touches them, and
    // groups() lists them after the main window's until the window counts are read, as the real tab-groups API does.
    otherWindows?: Tab[][];
    // What the bridge's focusMain answers; left out, there is no bridge.
    focusMain?: boolean;
    // Closing tabs waits for this before it takes effect, like a real close that is still in flight.
    closeGate?: Promise<void>;
  } = {},
) {
  const others: Group[] = (opts.otherWindows ?? []).map((tabs) => ({ tabs, held: tabs.length > 0 }));
  let windowsRead = false;
  const opens: TerminalOpen[] = [];
  const groups: Group[] = (opts.start ?? [[]]).map((tabs) => ({ tabs, held: tabs.length > 0 }));
  const calls: string[] = [];
  const logs: string[] = [];
  let focused = groups[0];
  let waiters: { holds: Holds; resolve: (t: object | undefined) => void }[] = [];
  let opened: { holds: Holds; tab: Tab } | undefined;

  // VS Code's closeEmptyGroups: on by default. keepEmptyGroups turns it off while placing, unless a project overrides it.
  let closeEmptyOn = true;
  const closeEmpty = () => {
    if (!closeEmptyOn) return;
    for (let i = groups.length - 1; i >= 0; i--) {
      if (groups.length > 1 && groups[i].tabs.length === 0 && groups[i].held) groups.splice(i, 1);
    }
  };
  const groupOf = (t: Tab) => groups.find((g) => g.tabs.includes(t));
  const at = (g: Group) => groups.indexOf(g);
  const live = (g: Group) => {
    if (at(g) < 0) throw new Error('that group is closed');
    return g;
  };

  const editors: Editors = {
    groups: () => (windowsRead ? [...groups] : [...groups, ...others]),
    useMainWindow: async () => {
      windowsRead = true;
    },
    useAllWindows: () => {
      windowsRead = false;
    },
    tabs: (g) => (g as Group).tabs,
    kind: (t) => (t as Tab).holds,
    label: (t) => (t as Tab).label,
    focus: async (g) => {
      focused = live(g as Group);
      calls.push(`focus ${at(focused)}`);
    },
    moveTab: async (t, to) => {
      const target = live(to as Group);
      const from = groupOf(t as Tab);
      if (!from) throw new Error('no such tab');
      from.tabs.splice(from.tabs.indexOf(t as Tab), 1);
      target.tabs.push(t as Tab);
      target.held = true;
      calls.push(`move ${(t as Tab).label} to ${at(target)}`);
      closeEmpty();
    },
    closeTabs: async (tabs) => {
      await opts.closeGate;
      for (const t of tabs as Tab[]) {
        const from = groupOf(t);
        from?.tabs.splice(from.tabs.indexOf(t), 1);
        calls.push(`close ${t.label}`);
      }
      closeEmpty();
    },
    openTerminal: async (g, open) => {
      const target = live(g as Group);
      if (open) opens.push(open);
      target.tabs.push(tab('terminal', open?.name));
      target.held = true;
      calls.push(`terminal in ${at(target)}`);
    },
    closeGroup: async (g) => {
      const target = live(g as Group);
      if (target.tabs.length > 0) throw new Error('that group is not empty');
      calls.push(`close group ${at(target)}`);
      groups.splice(at(target), 1);
    },
    keepEmptyGroups: async (work) => {
      const before = closeEmptyOn;
      if (!opts.keepIgnored) closeEmptyOn = false;
      calls.push(opts.keepIgnored ? 'keep-empty ignored' : 'keep-empty on');
      try {
        return await work();
      } finally {
        closeEmptyOn = before;
        calls.push('keep-empty off');
      }
    },
    waitForTab: (holds) => new Promise((resolve) => waiters.push({ holds, resolve })),
    settled: async () => {
      calls.push('settled');
      for (const t of groups.flatMap((g) => g.tabs)) {
        if (t.arrives !== undefined) t.label = t.arrives;
        delete t.arrives;
      }
    },
  };

  const run = async (command: string) => {
    calls.push(`run ${command}`);
    opened = undefined;
    if (command === AGENTS.claudeCode.editor.command && (opts.claudeOpens ?? true)) {
      const t = tab('claudeCode');
      groups.splice(1, 0, { tabs: [t], held: true });
      opened = { holds: 'claudeCode', tab: t };
    } else if (command === AGENTS.codex.editor.command && (opts.codexOpens ?? true)) {
      const t = tab('codex');
      focused.tabs.push(t);
      focused.held = true;
      opened = { holds: 'codex', tab: t };
    }
    const pending = waiters;
    waiters = [];
    for (const w of pending) w.resolve(opened?.holds === w.holds ? opened.tab : undefined);
  };

  const state: LayoutState = {
    window: { width: 1000, height: 800 },
    panelPosition: 'bottom',
    parts: { sidebar: { visible: true, size: 300 }, auxiliarybar: { visible: true, size: 300 }, panel: { visible: true, size: 200 } },
  };
  const host: MyLayoutHost = {
    ...(opts.focusMain === undefined
      ? {}
      : {
          focusMain: async () => {
            calls.push('focus main');
            return opts.focusMain;
          },
        }),
    planTerminal: async (t: CellTerminal) => ({
      open: { name: terminalName(t), ...(t.folder ? { cwd: t.folder } : {}), ...(t.command ? { command: t.command } : {}) },
      problems: opts.terminalProblems ?? [],
    }),
    run,
    bridge: {
      state: async () => state,
      setSize: async (part, pixels) => {
        calls.push(`size ${part} ${pixels}`);
        return pixels;
      },
      locate: async () => 'sidebar',
      moveContainer: async () => true,
    },
    grid: {
      apply: async (layout) => {
        if (opts.gridFails) throw new Error('no such command');
        calls.push(`grid ${leaves(layout)}`);
        if (opts.gridIgnored) return;
        while (groups.length < leaves(layout)) groups.push({ tabs: [], held: false });
        while (groups.length > leaves(layout)) {
          const last = groups.pop()!;
          groups[groups.length - 1].tabs.push(...last.tabs);
        }
      },
    },
    editors,
    sideBarOnRight: false,
    hyperspaceActive: () => false,
    log: (line) => logs.push(line),
    tell: () => undefined,
  };
  return { host, groups, others, calls, logs, editors, opens };
}

// Three columns, the third split into two rows: Claude Code, Codex, a terminal, and an empty cell.
const columns = (): Column[] => [
  { size: 0.4, rows: [{ size: 1, holds: 'claudeCode' }] },
  { size: 0.3, rows: [{ size: 1, holds: 'codex' }] },
  { size: 0.3, rows: [{ size: 0.6, holds: 'terminal' }, { size: 0.4 }] },
];
const layout = (extra: Partial<MyLayout> = {}): MyLayout => ({
  agents: { claudeCode: 'column', codex: 'column' },
  grid: toSavedGrid(columns()),
  ...extra,
});
// What was asked of the window, without the bookkeeping of holding empty groups open.
const asked = (calls: string[]) => calls.filter((c) => !c.startsWith('keep-empty'));
const heldBy = (w: ReturnType<typeof editorWindow>) => w.groups.map((g) => g.tabs.map((t) => t.holds ?? 'file'));

suite('my layout: columns', () => {
  test('sets the grid first, then puts each agent and terminal in its cell, leaving the empty cell empty', async () => {
    const w = editorWindow();
    const out = await applyLayout(w.host, layout());
    assert.strictEqual(w.calls[0], 'grid 4');
    assert.deepStrictEqual(heldBy(w), [['claudeCode'], ['codex'], ['terminal'], []]);
    assert.deepStrictEqual(out, { placed: ['claudeCode', 'codex'], problems: [], openAsTab: [] });
  });

  test('holds the target group by reference when Claude Code adds a group of its own', async () => {
    const w = editorWindow();
    await applyLayout(w.host, layout({ agents: { claudeCode: 'column' }, grid: toSavedGrid([{ size: 0.5, rows: [{ size: 1 }] }, { size: 0.5, rows: [{ size: 1, holds: 'claudeCode' }] }]) }));
    // Opened beside the first group (shifting the numbers), moved to the second cell, the extra group gone.
    assert.deepStrictEqual(heldBy(w), [[], ['claudeCode']]);
    assert.strictEqual(w.groups.length, 2);
  });

  test('Codex opens in the focused cell, so it is focused first and not moved', async () => {
    const w = editorWindow();
    await applyLayout(w.host, layout({ agents: { codex: 'column' }, grid: toSavedGrid([{ size: 0.5, rows: [{ size: 1 }] }, { size: 0.5, rows: [{ size: 1, holds: 'codex' }] }]) }));
    assert.ok(w.calls.indexOf('focus 1') < w.calls.indexOf(`run ${AGENTS.codex.editor.command}`));
    assert.ok(!w.calls.some((c) => c.startsWith('move')));
  });

  test('an agent already open in its cell is left alone, and one open elsewhere is moved, not reopened', async () => {
    const inPlace = editorWindow({ start: [[tab('claudeCode')], [tab('codex')], [tab('terminal')], []] });
    await applyLayout(inPlace.host, layout());
    assert.deepStrictEqual(asked(inPlace.calls), ['grid 4']);

    // Claude Code sits in the cell meant for the empty one; the file beside it keeps that group open when it leaves.
    const elsewhere = editorWindow({ start: [[], [tab('codex')], [tab('terminal')], [tab('claudeCode'), tab()]] });
    const out = await applyLayout(elsewhere.host, layout());
    assert.deepStrictEqual(out.problems, []);
    assert.ok(elsewhere.calls.includes('move claudeCode to 0'));
    assert.ok(!elsewhere.calls.some((c) => c.startsWith('run')));
  });

  test('running it twice opens nothing the second time', async () => {
    const w = editorWindow();
    await applyLayout(w.host, layout());
    const first = w.calls.length;
    const out = await applyLayout(w.host, layout());
    assert.deepStrictEqual(asked(w.calls.slice(first)), ['grid 4']);
    assert.deepStrictEqual(heldBy(w), [['claudeCode'], ['codex'], ['terminal'], []]);
    assert.deepStrictEqual(out.problems, []);
  });

  test('moving the only tab out of a group does not close the group: the cell stays', async () => {
    // Claude Code sits alone in the third group, which the terminal is meant for.
    const w = editorWindow({ start: [[], [], [tab('claudeCode')], []] });
    const grid = toSavedGrid([
      { size: 0.3, rows: [{ size: 1, holds: 'claudeCode' }] },
      { size: 0.3, rows: [{ size: 1 }] },
      { size: 0.4, rows: [{ size: 0.5, holds: 'terminal' }, { size: 0.5 }] },
    ]);
    const out = await applyLayout(w.host, { agents: { claudeCode: 'column' }, grid });
    assert.deepStrictEqual(out.problems, []);
    assert.deepStrictEqual(heldBy(w), [['claudeCode'], [], ['terminal'], []]);
  });

  test('a planned empty cell before an agent that sits alone in its group: stable over repeated restores', async () => {
    // Cells [empty, Claude Code], but Claude Code is alone in the first group.
    const grid = toSavedGrid([{ size: 0.5, rows: [{ size: 1 }] }, { size: 0.5, rows: [{ size: 1, holds: 'claudeCode' }] }]);
    const w = editorWindow({ start: [[tab('claudeCode')], []] });
    for (let i = 0; i < 3; i++) {
      const out = await applyLayout(w.host, { agents: { claudeCode: 'column' }, grid });
      assert.deepStrictEqual(out.problems, [], 'run ' + (i + 1));
      assert.deepStrictEqual(heldBy(w), [[], ['claudeCode']], 'run ' + (i + 1));
    }
  });

  test('two agents that sit in each other\'s cells swap in one run', async () => {
    const w = editorWindow({ start: [[tab('codex')], [tab('claudeCode')]] });
    const grid = toSavedGrid([{ size: 0.5, rows: [{ size: 1, holds: 'claudeCode' }] }, { size: 0.5, rows: [{ size: 1, holds: 'codex' }] }]);
    const out = await applyLayout(w.host, layout({ grid }));
    assert.deepStrictEqual(out.problems, []);
    assert.deepStrictEqual(heldBy(w), [['claudeCode'], ['codex']]);
  });

  test('only the groups an agent opened for itself are closed, never a cell of the grid', async () => {
    const w = editorWindow();
    await applyLayout(w.host, layout());
    assert.strictEqual(w.calls.filter((c) => c.startsWith('close group')).length, 1);
    assert.strictEqual(w.groups.length, 4);
  });

  test('the setting is put back after placing, even when a cell fails', async () => {
    const w = editorWindow({ codexOpens: false });
    await applyLayout(w.host, layout());
    assert.strictEqual(w.calls.at(-1) === 'keep-empty off' || w.calls.includes('keep-empty off'), true);
    assert.ok(w.calls.indexOf('keep-empty on') < w.calls.indexOf('keep-empty off'));
  });

  test('if the setting cannot be held off (a project overrides it), a closed column is reported, not looped on', async () => {
    const w = editorWindow({ start: [[tab('codex')], [tab('claudeCode')]], keepIgnored: true });
    const grid = toSavedGrid([{ size: 0.5, rows: [{ size: 1, holds: 'claudeCode' }] }, { size: 0.5, rows: [{ size: 1, holds: 'codex' }] }]);
    const out = await applyLayout(w.host, layout({ grid }));
    assert.ok(out.problems.some((p) => /column closed/.test(p)), out.problems.join(' | '));
  });

  test('one agent that will not open is reported, and the other cells are still filled', async () => {
    const w = editorWindow({ codexOpens: false });
    const out = await applyLayout(w.host, layout());
    assert.strictEqual(out.problems.length, 1);
    assert.match(out.problems[0], /Codex/);
    assert.deepStrictEqual(heldBy(w), [['claudeCode'], [], ['terminal'], []]);
    assert.deepStrictEqual(out.placed, ['claudeCode']);
  });

  test('if the grid does not come out with the groups asked for, nothing is placed and it is reported', async () => {
    const w = editorWindow({ gridIgnored: true });
    const out = await applyLayout(w.host, layout());
    assert.strictEqual(out.problems.length, 1);
    assert.match(out.problems[0], /1 groups.*not 4/);
    assert.ok(!w.calls.some((c) => c.startsWith('run') || c.startsWith('terminal')));
  });

  test('a grid that cannot be set, or a window that cannot set one, is reported', async () => {
    const failing = editorWindow({ gridFails: true });
    const a = await applyLayout(failing.host, layout());
    assert.strictEqual(a.problems.length, 1);
    assert.match(a.problems[0], /could not be set/);

    const bare = editorWindow();
    const b = await applyLayout({ ...bare.host, grid: undefined, editors: undefined }, layout());
    assert.strictEqual(b.problems.length, 1);
    assert.match(b.problems[0], /could not be set/);
  });

  test('agents placed in a column with no valid grid saved are reported, and nothing is run', async () => {
    const w = editorWindow();
    const out = await applyLayout(w.host, { agents: { claudeCode: 'column', codex: 'left' } });
    assert.ok(out.problems.some((p) => /Claude Code.*no valid editor grid/.test(p)));
    assert.ok(!w.calls.some((c) => c.startsWith('grid') || c.includes(AGENTS.claudeCode.editor.command)));
  });

  test('no grid saved leaves the editor area untouched', async () => {
    const w = editorWindow({ start: [[tab(), tab('claudeCode')]] });
    await applyLayout(w.host, { agents: { codex: 'right' } });
    assert.ok(!w.calls.some((c) => c.startsWith('grid') || c.startsWith('move') || c.startsWith('close')));
  });

  test('sizes are set after the columns', async () => {
    const w = editorWindow();
    await applyLayout(w.host, layout({ sizes: { sidebar: 0.2 } }));
    const size = w.calls.findIndex((c) => c.startsWith('size'));
    assert.ok(size > w.calls.findIndex((c) => c.startsWith('terminal')));
  });

  suite('an agent also open as an editor tab', () => {
    test('is reported when the agent is placed in a side bar or the panel, and nothing is closed', async () => {
      const w = editorWindow({ start: [[tab('codex'), tab()], [tab('claudeCode')]] });
      const out = await applyLayout(w.host, { agents: { codex: 'left', claudeCode: 'panel' } });
      assert.deepStrictEqual(out.openAsTab, ['claudeCode', 'codex']);
      assert.ok(!w.calls.some((c) => c.startsWith('close')));
      assert.deepStrictEqual(heldBy(w), [['codex', 'file'], ['claudeCode']]);
    });

    test('is not reported for an agent that is not placed in a side bar or the panel', async () => {
      const w = editorWindow({ start: [[tab('codex')]] });
      const out = await applyLayout(w.host, { agents: { claudeCode: 'left' } });
      assert.deepStrictEqual(out.openAsTab, []);
    });

    test('Close it closes that agent\'s tabs and no others', async () => {
      const w = editorWindow({ start: [[tab('codex'), tab()], [tab('codex'), tab('terminal')]] });
      await closeAgentTabs(w.editors, ['codex']);
      assert.deepStrictEqual(heldBy(w), [['file'], ['terminal']]);
    });

    test('a conversation opened while the closing is still going is not closed with the rest', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const w = editorWindow({ start: [[tab('claudeCode'), tab('codex', 'Fix the bug')], [tab()]], closeGate: gate });
      const out = await applyLayout(w.host, { agents: { claudeCode: 'left', codex: 'right' } });
      assert.deepStrictEqual(out.openAsTab, ['claudeCode', 'codex']);

      // The person presses Close it; the closes are in flight when a new Codex conversation opens (it may hold an unsent draft).
      const pressing = reportOutcome(out, offerUi().ui, (ids) => closeAgentTabs(w.editors, ids));
      await new Promise((resolve) => setTimeout(resolve, 0));
      w.groups[1].tabs.push(tab('codex', 'New chat'));
      release();
      await pressing;
      // Both reported tabs are gone (and their emptied column with them); the new conversation is still open.
      assert.deepStrictEqual(heldBy(w), [['file', 'codex']]);
      assert.strictEqual(w.groups[0].tabs[1].label, 'New chat');
    });

    // The button on a report that has been overtaken does nothing: a conversation opened since may hold an unsent draft,
    // and a layout applied since may need the tab it would close.
    const offerUi = () => {
      const told: string[] = [];
      return { told, ui: { tell: (m: string) => void told.push(m), offer: async () => true } };
    };

    test('an applied layout puts an end to earlier reports, so their button closes nothing', async () => {
      const w = editorWindow({ start: [[tab('codex', 'Fix the bug'), tab()]] });
      const first = await applyLayout(w.host, { agents: { codex: 'left' } });
      assert.deepStrictEqual(first.openAsTab, ['codex']);
      await applyLayout(w.host, { agents: { codex: 'right' } }); // another layout is applied while the first report is open
      const u = offerUi();
      await reportOutcome(first, u.ui, (ids) => closeAgentTabs(w.editors, ids));
      assert.deepStrictEqual(heldBy(w), [['codex', 'file']], 'the tab is still there');
      assert.match(u.told[0], /out of date/);
    });

    test('a report that is still current closes the tab when the button is pressed', async () => {
      const w = editorWindow({ start: [[tab('codex', 'Fix the bug'), tab()]] });
      const out = await applyLayout(w.host, { agents: { codex: 'left' } });
      await reportOutcome(out, offerUi().ui, (ids) => closeAgentTabs(w.editors, ids));
      assert.deepStrictEqual(heldBy(w), [['file']]);
    });
  });

  suite('a chosen terminal', () => {
    const terminalGrid = (terminal?: CellTerminal): MyLayout => ({
      grid: toSavedGrid([{ size: 1, rows: [{ size: 1, holds: 'terminal', ...(terminal ? { terminal } : {}) }] }]),
    });

    test('opens as planned, named and with its startup command, in its cell', async () => {
      const w = editorWindow();
      const out = await applyLayout(w.host, terminalGrid({ shell: 'gitbash', name: 'Dev', folder: 'web', command: 'npm run dev' }));
      assert.deepStrictEqual(w.opens, [{ name: 'Dev', cwd: 'web', command: 'npm run dev' }]);
      assert.deepStrictEqual(w.groups.map((g) => g.tabs.map((t) => t.label)), [['Dev']]);
      assert.deepStrictEqual(out.problems, []);
    });

    test('restoring again with it still in its cell opens nothing and runs nothing', async () => {
      const w = editorWindow();
      await applyLayout(w.host, terminalGrid({ shell: 'gitbash', command: 'npm run dev' }));
      await applyLayout(w.host, terminalGrid({ shell: 'gitbash', command: 'npm run dev' }));
      assert.strictEqual(w.opens.length, 1);
      assert.deepStrictEqual(w.groups.map((g) => g.tabs.map((t) => t.label)), [['Git Bash']]);
    });

    test('another terminal in the cell does not count: the chosen one opens beside it', async () => {
      const w = editorWindow({ start: [[tab('terminal', 'pwsh')]] });
      await applyLayout(w.host, terminalGrid({ name: 'Dev' }));
      assert.deepStrictEqual(w.groups.map((g) => g.tabs.map((t) => t.label)), [['pwsh', 'Dev']]);
    });

    test('a cell saved without a choice of terminal still counts any terminal, and opens the default one', async () => {
      const filled = editorWindow({ start: [[tab('terminal', 'pwsh')]] });
      await applyLayout(filled.host, terminalGrid());
      assert.ok(!filled.calls.some((c) => c.startsWith('terminal')));
      const empty = editorWindow();
      await applyLayout(empty.host, terminalGrid());
      assert.deepStrictEqual(empty.opens, []);
      assert.ok(empty.calls.includes('terminal in 0'));
    });

    // VS Code brings terminals back after a reload in the groups it remembers, which can be one off from the saved grid.
    const twoTerminals = (): MyLayout => ({
      grid: toSavedGrid([
        {
          size: 1,
          rows: [{ size: 0.2 }, { size: 0.4, holds: 'terminal', terminal: { shell: 'powershell' } }, { size: 0.4, holds: 'terminal', terminal: { shell: 'gitbash' } }],
        },
      ]),
    });

    test('terminals that came back one group early are moved into their cells, not opened again', async () => {
      const w = editorWindow({ start: [[tab('terminal', 'PowerShell')], [tab('terminal', 'Git Bash')], []] });
      await applyLayout(w.host, twoTerminals());
      assert.deepStrictEqual(w.opens, []);
      assert.deepStrictEqual(w.groups.map((g) => g.tabs.map((t) => t.label)), [[], ['PowerShell'], ['Git Bash']]);
    });

    test('a terminal in a cell that wants the same terminal is not taken for another cell', async () => {
      const same = (): MyLayout => ({
        grid: toSavedGrid([{ size: 1, rows: [{ size: 0.5, holds: 'terminal', terminal: { shell: 'gitbash' } }, { size: 0.5, holds: 'terminal', terminal: { shell: 'gitbash' } }] }]),
      });
      const w = editorWindow({ start: [[], [tab('terminal', 'Git Bash')]] });
      await applyLayout(w.host, same());
      assert.strictEqual(w.opens.length, 1);
      assert.deepStrictEqual(w.groups.map((g) => g.tabs.map((t) => t.label)), [['Git Bash'], ['Git Bash']]);
    });

    test('a terminal of another name is left where it is', async () => {
      const w = editorWindow({ start: [[], [tab('terminal', 'pwsh')]] });
      await applyLayout(w.host, terminalGrid({ shell: 'gitbash' }));
      // The one-cell grid folds the second group into the first; its terminal stays a terminal of its own.
      assert.deepStrictEqual(w.groups.map((g) => g.tabs.map((t) => t.label)), [['pwsh', 'Git Bash']]);
      assert.strictEqual(w.opens.length, 1);
    });

    const noChoiceThenGitBash = (): MyLayout => ({
      grid: toSavedGrid([{ size: 1, rows: [{ size: 0.5, holds: 'terminal' }, { size: 0.5, holds: 'terminal', terminal: { shell: 'gitbash' } }] }]),
    });
    const labels = (w: ReturnType<typeof editorWindow>) => w.groups.map((g) => g.tabs.map((t) => t.label));

    test('the terminal that fills a cell saved without a choice is not taken by a later named cell', async () => {
      const w = editorWindow({ start: [[tab('terminal', 'Git Bash')], []] });
      await applyLayout(w.host, noChoiceThenGitBash());
      assert.deepStrictEqual(labels(w), [['Git Bash'], ['Git Bash']]);
      assert.strictEqual(w.opens.length, 1);
      await applyLayout(w.host, noChoiceThenGitBash());
      assert.deepStrictEqual(labels(w), [['Git Bash'], ['Git Bash']]);
      assert.strictEqual(w.opens.length, 1);
    });

    test('a revived terminal whose name has not come back yet is waited for, not opened again', async () => {
      const w = editorWindow({ start: [[{ holds: 'terminal', label: '', arrives: 'Git Bash' }]] });
      await applyLayout(w.host, terminalGrid({ shell: 'gitbash', command: 'npm run dev' }));
      assert.deepStrictEqual(w.opens, []);
      assert.deepStrictEqual(labels(w), [['Git Bash']]);
    });

    test('a name that never comes back is waited for only once, and the terminal then opens', async () => {
      const w = editorWindow({ start: [[{ holds: 'terminal', label: '' }]] });
      await applyLayout(w.host, terminalGrid({ shell: 'gitbash' }));
      assert.strictEqual(w.calls.filter((c) => c === 'settled').length, 1);
      assert.strictEqual(w.opens.length, 1);
    });

    test('a shell or folder that fell back is reported, and the terminal is still in its cell', async () => {
      const w = editorWindow({ terminalProblems: ['Git Bash: Git Bash was not found on this machine, so it opened in the default shell'] });
      const out = await applyLayout(w.host, terminalGrid({ shell: 'gitbash' }));
      assert.deepStrictEqual(out.problems, ['Git Bash: Git Bash was not found on this machine, so it opened in the default shell']);
      assert.deepStrictEqual(w.groups.map((g) => g.tabs.map((t) => t.label)), [['Git Bash']]);
    });
  });

  suite('with other editor windows open', () => {
    test('places in the main window only, and leaves the other windows as they were', async () => {
      const page = tab(undefined, 'Choose Layout');
      const w = editorWindow({ otherWindows: [[page], [tab(undefined, 'notes.md')]] });
      const out = await applyLayout(w.host, layout());
      assert.deepStrictEqual(out.problems, []);
      assert.deepStrictEqual(heldBy(w), [['claudeCode'], ['codex'], ['terminal'], []]);
      assert.deepStrictEqual(w.others.map((g) => g.tabs.map((t) => t.label)), [['Choose Layout'], ['notes.md']]);
    });

    test('brings the main window to the front before the grid is set', async () => {
      const w = editorWindow({ focusMain: true });
      await applyLayout(w.host, layout());
      assert.ok(w.calls.indexOf('focus main') >= 0 && w.calls.indexOf('focus main') < w.calls.indexOf('grid 4'), w.calls.join('; '));
    });

    test('if the main window cannot be brought to the front, the grid is left alone and that is reported; sizes still apply', async () => {
      const w = editorWindow({ focusMain: false, start: [[tab()]] });
      const out = await applyLayout(w.host, layout({ sizes: { sidebar: 0.2 } }));
      assert.ok(!w.calls.some((c) => c.startsWith('grid') || c.startsWith('terminal') || c.startsWith('run')), w.calls.join('; '));
      assert.ok(
        out.problems.includes('the main window could not be brought to the front, so the editor grid was left alone; click the main window and run Restore Layout again'),
        out.problems.join('; '),
      );
      assert.ok(w.calls.some((c) => c.startsWith('size sidebar')));
      assert.deepStrictEqual(heldBy(w), [['file']]);
    });
  });

  suite('holdsOfTab', () => {
    test('knows Claude Code, Codex and terminals by the tab they open', () => {
      assert.strictEqual(holdsOfTab({ type: 'webview', viewType: 'mainThreadWebview-claudeVSCodePanel' }), 'claudeCode');
      assert.strictEqual(holdsOfTab({ type: 'custom', viewType: 'chatgpt.conversationEditor' }), 'codex');
      assert.strictEqual(holdsOfTab({ type: 'terminal' }), 'terminal');
    });

    test('anything else is not ours', () => {
      assert.strictEqual(holdsOfTab({ type: 'webview', viewType: 'markdown.preview' }), undefined);
      assert.strictEqual(holdsOfTab({ type: 'custom', viewType: 'vscode.markdown.preview.editor' }), undefined);
      assert.strictEqual(holdsOfTab({ type: 'other' }), undefined);
    });
  });

  test('the container ids the side views use are the prefixed ones (guards the helper this file imports)', () => {
    assert.strictEqual(coreContainerId('x'), 'workbench.view.extension.x');
  });
});
