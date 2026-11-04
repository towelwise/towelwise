import * as assert from 'node:assert';
import { Column, toSavedGrid } from '../columns';
import { LayoutDraft, LayoutEnv, parseLayoutMessage } from '../layoutDraft';
import { LayoutState } from '../sizes';

const live = (panelPosition: LayoutState['panelPosition'] = 'bottom'): LayoutState => ({
  window: { width: 1000, height: 800 },
  panelPosition,
  parts: {
    sidebar: { visible: true, size: 300 },
    auxiliarybar: { visible: true, size: 250 },
    panel: { visible: true, size: 200 },
  },
});

interface Written {
  agents: object;
  grid: object;
  sizes: object;
}

function envWith(state: LayoutState | undefined = live(), gate?: Promise<void>) {
  const writes: Written[] = [];
  let first = true;
  const env: LayoutEnv = {
    read: async () => {
      // Only the first read waits, so a test can hold a capture open.
      if (gate && first) {
        first = false;
        await gate;
      }
      return state;
    },
    write: async (values) => void writes.push(values as Written),
  };
  return { env, writes };
}

const threeColumns = (): Column[] => [
  { size: 0.4, rows: [{ size: 1, holds: 'claudeCode' }] },
  { size: 0.3, rows: [{ size: 1, holds: 'codex' }] },
  { size: 0.3, rows: [{ size: 0.6, holds: 'terminal' }, { size: 0.4 }] },
];

suite('layout draft', () => {
  test('starts empty when nothing is saved: no agents chosen, no columns, no sizes', () => {
    const { env } = envWith();
    const view = new LayoutDraft(undefined, env).view();
    assert.deepStrictEqual(view.agents.map((a) => [a.id, a.place]), [['claudeCode', ''], ['codex', '']]);
    assert.strictEqual(view.grid.on, false);
    assert.deepStrictEqual(view.sizes.rows.map((r) => r.percent), ['', '', '']);
  });

  test('shows a saved layout: places, columns with what they hold, and sizes as percentages', () => {
    const { env } = envWith();
    const saved = { agents: { claudeCode: 'column', codex: 'column' } as const, grid: toSavedGrid(threeColumns()), sizes: { sidebar: 0.25 } };
    const view = new LayoutDraft(saved, env).view();
    assert.deepStrictEqual(view.agents.map((a) => a.place), ['column', 'column']);
    assert.strictEqual(view.grid.on, true);
    assert.deepStrictEqual(view.grid.columns!.map((c) => c.rows.map((r) => r.holds)), [['claudeCode'], ['codex'], ['terminal', '']]);
    assert.strictEqual(view.sizes.rows[0].percent, '25');
  });

  test('choosing a column for an agent turns on two empty columns; the agent then goes in a cell', async () => {
    const { env, writes } = envWith();
    const draft = new LayoutDraft(undefined, env);
    draft.setPlace('codex', 'column');
    assert.strictEqual(draft.view().grid.on, true);
    assert.strictEqual(draft.view().grid.columns!.length, 2);
    draft.assign(1, 0, 'codex');
    assert.deepStrictEqual(await draft.save(), { ok: true });
    assert.deepStrictEqual(writes[0].agents, { codex: 'column' });
    assert.deepStrictEqual(writes[0].grid, { orientation: 0, groups: [{ size: 0.5 }, { size: 0.5, holds: 'codex' }] });
    assert.deepStrictEqual(writes[0].sizes, {});
  });

  test('a cell offers only the agents placed in a column, and a terminal', () => {
    const { env } = envWith();
    const draft = new LayoutDraft(undefined, env);
    draft.setPlace('claudeCode', 'left');
    draft.setPlace('codex', 'column');
    const choices = draft.view().grid.columns![0].rows[0].choices.map((c) => c.value);
    assert.deepStrictEqual(choices, ['', 'codex', 'terminal']);
  });

  test('an agent that cannot go in a cell is not put in one', () => {
    const { env } = envWith();
    const draft = new LayoutDraft(undefined, env);
    draft.setPlace('claudeCode', 'left');
    draft.useColumns();
    draft.assign(0, 0, 'claudeCode');
    assert.strictEqual(draft.view().grid.columns![0].rows[0].holds, '');
  });

  test('moving an agent out of a column empties its cell; the grid stays', () => {
    const { env } = envWith();
    const draft = new LayoutDraft({ agents: { codex: 'column' }, grid: toSavedGrid(threeColumns().slice(1)) }, env);
    draft.setPlace('codex', 'right');
    assert.deepStrictEqual(draft.view().grid.columns!.map((c) => c.rows.map((r) => r.holds)), [[''], ['terminal', '']]);
  });

  test('Save refuses a column agent that is in no cell, saying why, and writes nothing', async () => {
    const { env, writes } = envWith();
    const draft = new LayoutDraft(undefined, env);
    draft.setPlace('codex', 'column');
    const result = await draft.save();
    assert.strictEqual(result.ok, false);
    assert.match((result as { problem: string }).problem, /Codex.*exactly one cell/);
    assert.deepStrictEqual(writes, []);
  });

  test('removing the columns while an agent needs one is refused at Save', async () => {
    const { env, writes } = envWith();
    const grid = toSavedGrid([{ size: 0.5, rows: [{ size: 1 }] }, { size: 0.5, rows: [{ size: 1, holds: 'codex' }] }]);
    const draft = new LayoutDraft({ agents: { codex: 'column' }, grid }, env);
    draft.removeColumns();
    assert.strictEqual(draft.view().grid.on, false);
    assert.strictEqual((await draft.save()).ok, false);
    assert.deepStrictEqual(writes, []);
  });

  test('building: add and remove columns and rows, and drag a splitter', () => {
    const { env } = envWith();
    const draft = new LayoutDraft(undefined, env);
    draft.useColumns();
    draft.addColumn('right');
    draft.addRow(0, 0);
    let cols = draft.view().grid.columns!;
    assert.strictEqual(cols.length, 3);
    assert.strictEqual(cols[0].rows.length, 2);
    draft.dragEdge('column', 0, 0, 0.5);
    cols = draft.view().grid.columns!;
    assert.ok(cols[0].size > 0.49 && cols[0].size < 0.51);
    draft.removeRow(0, 1);
    draft.removeColumn(2);
    cols = draft.view().grid.columns!;
    assert.strictEqual(cols.length, 2);
    assert.strictEqual(cols[0].rows.length, 1);
  });

  test('a refused add or split says why, and the next change that works clears the message', () => {
    const { env } = envWith();
    const draft = new LayoutDraft(undefined, env);
    draft.useColumns();
    for (let i = 0; i < 10; i++) draft.addColumn('right');
    assert.strictEqual(draft.view().grid.columns!.length, 10);
    assert.match(draft.view().grid.notice ?? '', /no room for another column/);
    draft.removeColumn(0);
    draft.addColumn('left');
    assert.strictEqual(draft.view().grid.notice, undefined);
    for (let i = 0; i < 10; i++) draft.addRow(0, 0);
    assert.match(draft.view().grid.notice ?? '', /too small to split/);
  });

  test('a terminal may be in several cells', async () => {
    const { env, writes } = envWith();
    const draft = new LayoutDraft(undefined, env);
    draft.useColumns();
    draft.assign(0, 0, 'terminal');
    draft.assign(1, 0, 'terminal');
    assert.deepStrictEqual(await draft.save(), { ok: true });
    assert.deepStrictEqual(writes[0].grid, { orientation: 0, groups: [{ size: 0.5, holds: 'terminal' }, { size: 0.5, holds: 'terminal' }] });
  });

  test('a saved grid the page cannot draw is kept as it is, with a note, until the person starts over', async () => {
    const { env, writes } = envWith();
    const deep = { orientation: 1 as const, groups: [{ size: 0.5 }, { size: 0.5 }] };
    const draft = new LayoutDraft({ agents: {}, grid: deep }, env);
    assert.strictEqual(draft.view().grid.kept, true);
    assert.match(draft.view().grid.note ?? '', /settings/);
    draft.addColumn('left');
    draft.setPlace('claudeCode', 'left');
    assert.strictEqual((await draft.save()).ok, true);
    assert.deepStrictEqual(writes[0].grid, deep);
    draft.startOver();
    assert.strictEqual(draft.view().grid.kept, false);
    assert.strictEqual(draft.view().grid.columns!.length, 2);
  });

  test('nothing chosen and nothing built saves empty settings, which clears the layout', async () => {
    const { env, writes } = envWith();
    assert.deepStrictEqual(await new LayoutDraft(undefined, env).save(), { ok: true });
    assert.deepStrictEqual(writes[0], { agents: {}, grid: {}, sizes: {} });
  });

  test('a change made while Save is reading the window does not split the saved pair, and Save says it is stale', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { env, writes } = envWith(live(), gate);
    const grid = toSavedGrid([{ size: 0.5, rows: [{ size: 1 }] }, { size: 0.5, rows: [{ size: 1, holds: 'codex' }] }]);
    const draft = new LayoutDraft({ agents: { codex: 'column' }, grid }, env);
    await draft.setSize('panel', '30');
    const save = draft.save();
    // Let Save start and reach its read of the window, which is held open.
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The page is still live: the person moves Codex to a side bar while Save waits for the panel's side.
    draft.setPlace('codex', 'right');
    release();
    assert.deepStrictEqual(await save, { ok: true, stale: true });
    // What was written is the draft as it was when Save was pressed: Codex in a column and in its cell.
    assert.deepStrictEqual(writes[0].agents, { codex: 'column' });
    assert.deepStrictEqual(writes[0].grid, { orientation: 0, groups: [{ size: 0.5 }, { size: 0.5, holds: 'codex' }] });
    // The draft itself has moved on, and a second Save saves that.
    assert.deepStrictEqual(await draft.save(), { ok: true });
    assert.deepStrictEqual(writes[1].agents, { codex: 'right' });
    assert.deepStrictEqual(writes[1].grid, { orientation: 0, groups: [{ size: 0.5 }, { size: 0.5 }] });
  });

  suite('sizes', () => {
    test('typed percentages are saved as proportions, and a typed panel takes the live side', async () => {
      const { env, writes } = envWith(live('right'));
      const draft = new LayoutDraft(undefined, env);
      await draft.setSize('sidebar', '25');
      await draft.setSize('panel', '30');
      assert.deepStrictEqual(await draft.save(), { ok: true });
      assert.deepStrictEqual(writes[0].sizes, { sidebar: 0.25, panel: 0.3, panelOrientation: 'across' });
    });

    test('a value out of range, or side bars leaving too little editor, is refused and nothing is written', async () => {
      const { env, writes } = envWith();
      const draft = new LayoutDraft(undefined, env);
      await draft.setSize('sidebar', '90');
      assert.strictEqual((await draft.save()).ok, false);
      await draft.setSize('sidebar', '50');
      await draft.setSize('auxiliarybar', '40');
      assert.strictEqual((await draft.save()).ok, false);
      assert.deepStrictEqual(writes, []);
    });

    test('Use current sizes fills what is visible; a cleared box stays empty', async () => {
      const { env, writes } = envWith();
      const draft = new LayoutDraft(undefined, env);
      await draft.useCurrentSizes();
      assert.deepStrictEqual(draft.view().sizes.rows.map((r) => r.percent), ['30', '25', '25']);
      await draft.setSize('auxiliarybar', '');
      assert.deepStrictEqual(await draft.save(), { ok: true });
      assert.deepStrictEqual(writes[0].sizes, { sidebar: 0.3, panel: 0.25, panelOrientation: 'down' });
    });

    test('a size typed while Use current sizes is reading wins over the capture, and Save waits for both', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const { env, writes } = envWith(live(), gate);
      const draft = new LayoutDraft(undefined, env);
      const capture = draft.useCurrentSizes();
      const typed = draft.setSize('sidebar', '35');
      const save = draft.save();
      release();
      await Promise.all([capture, typed]);
      assert.deepStrictEqual(await save, { ok: true });
      assert.strictEqual((writes[0].sizes as { sidebar: number }).sidebar, 0.35);
    });

    test('without the core bridge the sizes cannot be captured, and the page says so', async () => {
      const env: LayoutEnv = { read: async () => undefined, write: async () => undefined };
      const draft = new LayoutDraft(undefined, env);
      await draft.useCurrentSizes();
      assert.strictEqual(draft.view().sizes.available, false);
    });
  });

  suite('parseLayoutMessage', () => {
    test('accepts exactly the messages the page sends', () => {
      for (const ok of [
        { type: 'ready' },
        { type: 'save' },
        { type: 'cancel' },
        { type: 'restore' },
        { type: 'reload' },
        { type: 'useCurrentSizes' },
        { type: 'useColumns' },
        { type: 'removeColumns' },
        { type: 'startOver' },
        { type: 'place', agent: 'codex', place: 'left' },
        { type: 'place', agent: 'codex', place: '' },
        { type: 'addColumn', side: 'right' },
        { type: 'removeColumn', index: 0 },
        { type: 'addRow', column: 1, row: 0 },
        { type: 'removeRow', column: 1, row: 1 },
        { type: 'drag', axis: 'column', column: 0, size: 0.4 },
        { type: 'drag', axis: 'row', column: 0, row: 1, size: 0.4 },
        { type: 'assign', column: 0, row: 0, holds: 'terminal' },
        { type: 'assign', column: 0, row: 0, holds: '' },
        { type: 'size', part: 'sidebar', value: '25' },
      ]) {
        assert.deepStrictEqual(parseLayoutMessage(ok), ok, JSON.stringify(ok));
      }
    });

    test('drops anything else', () => {
      for (const bad of [
        undefined,
        null,
        'save',
        {},
        { type: 'nope' },
        { type: 'place', agent: 'cline', place: 'left' },
        { type: 'place', agent: 'codex', place: 'middle' },
        { type: 'addColumn', side: 'up' },
        { type: 'removeColumn', index: -1 },
        { type: 'removeColumn', index: 1.5 },
        { type: 'drag', axis: 'column', column: 0, size: 'x' },
        { type: 'drag', axis: 'diagonal', column: 0, size: 0.4 },
        { type: 'drag', axis: 'row', column: 0, size: 0.4 },
        { type: 'assign', column: 0, row: 0, holds: 'cline' },
        { type: 'size', part: 'status', value: '1' },
      ]) {
        assert.strictEqual(parseLayoutMessage(bad), undefined, JSON.stringify(bad));
      }
    });
  });
});
