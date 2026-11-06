import * as assert from 'node:assert';
import { parseSavedGrid } from '../grid';
import {
  Column,
  addColumn,
  addRow,
  assign,
  canAddColumn,
  canAddRow,
  defaultColumns,
  fromSavedGrid,
  hasStartupCommand,
  holdsInOrder,
  parseLayoutGrid,
  removeColumn,
  removeRow,
  dragColumnEdge,
  dragRowEdge,
  toSavedGrid,
  validatePlaces,
} from '../columns';

const sizes = (cols: Column[]) => cols.map((c) => Number(c.size.toFixed(4)));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const noLog = () => undefined;

// Three columns; the third is split into two rows. Claude Code left, Codex middle, a terminal top right.
const three = (): Column[] => [
  { size: 0.4, rows: [{ size: 1, holds: 'claudeCode' }] },
  { size: 0.3, rows: [{ size: 1, holds: 'codex' }] },
  { size: 0.3, rows: [{ size: 0.6, holds: 'terminal' }, { size: 0.4 }] },
];

suite('columns', () => {
  suite('building a grid', () => {
    test('starts as two equal empty columns', () => {
      const cols = defaultColumns();
      assert.deepStrictEqual(sizes(cols), [0.5, 0.5]);
      assert.deepStrictEqual(cols.map((c) => c.rows), [[{ size: 1 }], [{ size: 1 }]]);
    });

    test('adds an empty column on the left or the right and keeps the others in proportion', () => {
      const right = addColumn(three(), 'right');
      assert.strictEqual(right.length, 4);
      assert.ok(near(right[3].size, 0.25) && near(sum(right.map((c) => c.size)), 1));
      assert.ok(near(right[0].size / right[1].size, 0.4 / 0.3));
      assert.deepStrictEqual(right[3].rows, [{ size: 1 }]);
      const left = addColumn(three(), 'left');
      assert.ok(near(left[0].size, 0.25) && left[1].rows[0].holds === 'claudeCode');
    });

    test('removes a column, spreads its room over the rest, and never removes the last one', () => {
      const fewer = removeColumn(three(), 1);
      assert.strictEqual(fewer.length, 2);
      assert.ok(near(sum(fewer.map((c) => c.size)), 1));
      assert.ok(near(fewer[0].size / fewer[1].size, 0.4 / 0.3));
      assert.strictEqual(removeColumn([{ size: 1, rows: [{ size: 1 }] }], 0).length, 1);
    });

    test('adds a row under a row, taking half of its room', () => {
      const cols = addRow(three(), 0, 0);
      assert.deepStrictEqual(cols[0].rows, [{ size: 0.5, holds: 'claudeCode' }, { size: 0.5 }]);
      const more = addRow(three(), 2, 0);
      assert.deepStrictEqual(more[2].rows.map((r) => Number(r.size.toFixed(4))), [0.3, 0.3, 0.4]);
    });

    test('splitting a row over and over stops at the 10% floor', () => {
      let cols: Column[] = [{ size: 1, rows: [{ size: 1 }] }];
      for (let i = 0; i < 10; i++) cols = addRow(cols, 0, 0);
      assert.ok(cols[0].rows.every((r) => r.size >= 0.1 - 1e-9), JSON.stringify(cols[0].rows));
      assert.ok(near(sum(cols[0].rows.map((r) => r.size)), 1));
      assert.strictEqual(canAddRow(cols, 0, 0), false);
      assert.deepStrictEqual(addRow(cols, 0, 0), cols);
      // A row twice the floor can still be split.
      assert.strictEqual(canAddRow([{ size: 1, rows: [{ size: 0.2 }, { size: 0.8 }] }], 0, 0), true);
    });

    test('adding columns keeps every column at least 10%: narrow ones are not squeezed, and ten is the most', () => {
      const narrow: Column[] = [
        { size: 0.1, rows: [{ size: 1 }] },
        { size: 0.9, rows: [{ size: 1 }] },
      ];
      const added = addColumn(narrow, 'right');
      assert.ok(added.every((c) => c.size >= 0.1 - 1e-9), sizes(added).join(','));
      assert.ok(near(sum(added.map((c) => c.size)), 1));
      let cols = defaultColumns();
      for (let i = 0; i < 12; i++) cols = addColumn(cols, i % 2 ? 'left' : 'right');
      assert.strictEqual(cols.length, 10);
      assert.ok(cols.every((c) => c.size >= 0.1 - 1e-9), sizes(cols).join(','));
      assert.strictEqual(canAddColumn(cols), false);
      assert.deepStrictEqual(addColumn(cols, 'left'), cols);
    });

    test('removes a row; a column left with one row is a plain column again, keeping that row\'s content', () => {
      const cols = removeRow(three(), 2, 1);
      assert.deepStrictEqual(cols[2].rows, [{ size: 1, holds: 'terminal' }]);
      // The only row of a column cannot be removed.
      assert.deepStrictEqual(removeRow(three(), 0, 0)[0].rows, three()[0].rows);
    });

    test('dragging an edge trades room between its two neighbours only', () => {
      const cols = dragColumnEdge(three(), 0, 0.5);
      assert.deepStrictEqual(sizes(cols), [0.5, 0.2, 0.3]);
      const rows = dragRowEdge(three(), 2, 0, 0.25);
      assert.deepStrictEqual(rows[2].rows.map((r) => Number(r.size.toFixed(4))), [0.25, 0.75]);
      assert.deepStrictEqual(sizes(rows), [0.4, 0.3, 0.3]);
    });

    test('no cell is dragged below 10%, and an edge that is not there does nothing', () => {
      assert.deepStrictEqual(sizes(dragColumnEdge(three(), 0, 0.99)), [0.6, 0.1, 0.3]);
      assert.deepStrictEqual(sizes(dragColumnEdge(three(), 0, 0.01)), [0.1, 0.6, 0.3]);
      assert.deepStrictEqual(sizes(dragColumnEdge(three(), 2, 0.5)), [0.4, 0.3, 0.3]);
      assert.deepStrictEqual(sizes(dragColumnEdge(three(), -1, 0.5)), [0.4, 0.3, 0.3]);
      assert.deepStrictEqual(dragRowEdge(three(), 0, 0, 0.5)[0].rows, three()[0].rows);
    });

    test('assigning an agent moves it out of its old cell; a terminal may be in several; undefined empties a cell', () => {
      const moved = assign(three(), 1, 0, 'claudeCode');
      assert.strictEqual(moved[0].rows[0].holds, undefined);
      assert.strictEqual(moved[1].rows[0].holds, 'claudeCode');
      const terminals = assign(three(), 2, 1, 'terminal');
      assert.deepStrictEqual(holdsInOrder(toSavedGrid(terminals)), ['claudeCode', 'codex', 'terminal', 'terminal']);
      assert.strictEqual(assign(three(), 0, 0, undefined)[0].rows[0].holds, undefined);
    });

    test('the operations do not change what they were given', () => {
      const original = three();
      const before = JSON.stringify(original);
      addColumn(original, 'left');
      removeColumn(original, 0);
      addRow(original, 0, 0);
      assign(original, 1, 0, 'claudeCode');
      dragColumnEdge(original, 0, 0.5);
      dragRowEdge(original, 2, 0, 0.5);
      assert.strictEqual(JSON.stringify(original), before);
    });
  });

  suite('the saved form', () => {
    test('a column with one row is a plain cell; a column with rows is nested groups', () => {
      assert.deepStrictEqual(toSavedGrid(three()), {
        orientation: 0,
        groups: [
          { size: 0.4, holds: 'claudeCode' },
          { size: 0.3, holds: 'codex' },
          { size: 0.3, groups: [{ size: 0.6, holds: 'terminal' }, { size: 0.4 }] },
        ],
      });
    });

    test('reads back what it wrote', () => {
      assert.deepStrictEqual(fromSavedGrid(toSavedGrid(three())), three());
    });

    test('a grid the builder cannot show (rows at the top, or columns inside a row) is not read back', () => {
      assert.strictEqual(fromSavedGrid({ orientation: 1, groups: [{ size: 1 }] }), undefined);
      const deep = { orientation: 0 as const, groups: [{ size: 1, groups: [{ size: 0.5, groups: [{ size: 1 }, { size: 1 }] }, { size: 0.5 }] }] };
      assert.strictEqual(fromSavedGrid(deep), undefined);
    });

    test('cells in reading order: left to right, top to bottom within a column', () => {
      assert.deepStrictEqual(holdsInOrder(toSavedGrid(three())), ['claudeCode', 'codex', 'terminal', undefined]);
    });
  });

  suite('validatePlaces', () => {
    const grid = () => toSavedGrid(three());

    test('accepts a layout where each column agent is in exactly one cell', () => {
      assert.strictEqual(validatePlaces({ claudeCode: 'column', codex: 'column' }, grid()), undefined);
      // Terminals are not agents: any number, any place.
      assert.strictEqual(validatePlaces({ claudeCode: 'column', codex: 'column' }, toSavedGrid(assign(three(), 2, 1, 'terminal'))), undefined);
    });

    test('an agent placed in a column must be in a cell, and in only one', () => {
      assert.match(validatePlaces({ claudeCode: 'column', codex: 'column' }, toSavedGrid(assign(three(), 1, 0, undefined)))!, /Codex/);
      const twice: Column[] = [
        { size: 0.5, rows: [{ size: 1, holds: 'codex' }] },
        { size: 0.5, rows: [{ size: 1, holds: 'codex' }] },
      ];
      assert.match(validatePlaces({ codex: 'column' }, toSavedGrid(twice))!, /Codex.*only one|exactly one/);
    });

    test('an agent placed somewhere else must not be in a cell, and an agent not chosen cannot be in one', () => {
      assert.match(validatePlaces({ claudeCode: 'left', codex: 'column' }, grid())!, /Claude Code/);
      assert.match(validatePlaces({ codex: 'column' }, grid())!, /Claude Code/);
    });

    test('with no cells needed, any agents in side bars are fine', () => {
      assert.strictEqual(validatePlaces({ claudeCode: 'left', codex: 'right' }, undefined), undefined);
      assert.match(validatePlaces({ codex: 'column' }, undefined)!, /Codex/);
    });
  });

  suite('parseLayoutGrid', () => {
    const agents = { claudeCode: 'column', codex: 'column' } as const;

    test('accepts a saved grid with what each cell holds', () => {
      const saved = toSavedGrid(three());
      assert.deepStrictEqual(parseLayoutGrid(saved, agents, noLog), saved);
    });

    test('nothing saved gives no grid and no log line', () => {
      const logs: string[] = [];
      for (const empty of [undefined, {}]) assert.strictEqual(parseLayoutGrid(empty, agents, (l) => logs.push(l)), undefined);
      assert.deepStrictEqual(logs, []);
    });

    test('a grid that breaks the place rules, or holds something unknown, is ignored as a whole and logged', () => {
      const logs: string[] = [];
      const wrongPlaces = toSavedGrid(assign(three(), 1, 0, undefined));
      assert.strictEqual(parseLayoutGrid(wrongPlaces, agents, (l) => logs.push(l)), undefined);
      const unknown = { orientation: 0, groups: [{ size: 1, holds: 'cline' }] };
      assert.strictEqual(parseLayoutGrid(unknown, agents, (l) => logs.push(l)), undefined);
      assert.strictEqual(logs.length, 2);
    });
  });

  suite('holds in the shared grid parser', () => {
    test('a cell may hold an agent or a terminal; anything else makes the grid unusable', () => {
      const ok = { orientation: 0, groups: [{ size: 0.5, holds: 'codex' }, { size: 0.5, holds: 'terminal' }] };
      assert.deepStrictEqual(parseSavedGrid(ok, noLog), ok);
      assert.strictEqual(parseSavedGrid({ orientation: 0, groups: [{ size: 1, holds: 7 }] }, noLog), undefined);
    });
  });
});

suite('hasStartupCommand', () => {
  test('true only when some terminal cell, at any depth, has a startup command', () => {
    const cell = (terminal?: object) => ({ size: 1, holds: 'terminal' as const, ...(terminal ? { terminal } : {}) });
    assert.strictEqual(hasStartupCommand(undefined), false);
    assert.strictEqual(hasStartupCommand({ orientation: 0, groups: [cell({ name: 'a' }), cell()] }), false);
    assert.strictEqual(hasStartupCommand({ orientation: 0, groups: [cell(), { size: 1, groups: [cell(), cell({ command: 'npm run dev' })] }] }), true);
  });
});
