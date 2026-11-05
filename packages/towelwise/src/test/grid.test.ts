import * as assert from 'node:assert';
import { attachLabels, leafCount, maxDifference, parseLayout, parseSavedGrid, sameShape, toLayout, toSaved } from '../grid';

// Three columns; the third is split into two rows. Sizes are pixels, as getEditorLayout reports them.
const live = () => ({
  orientation: 0,
  groups: [{ size: 400 }, { size: 300 }, { size: 300, groups: [{ size: 600 }, { size: 200 }] }],
});

suite('grid', () => {
  suite('parseLayout', () => {
    test('accepts what getEditorLayout returns', () => {
      assert.deepStrictEqual(parseLayout(live()), live());
    });

    test('rejects anything that is not a layout of sized groups', () => {
      for (const bad of [
        undefined,
        null,
        'x',
        {},
        { orientation: 2, groups: [{ size: 1 }] },
        { orientation: 0, groups: [] },
        { orientation: 0, groups: [{ size: 0 }] },
        { orientation: 0, groups: [{ size: 'a' }] },
        { orientation: 0, groups: [{ size: 1, groups: [] }] },
        { orientation: 0, groups: [{ size: 1, groups: [{}] }] },
      ]) {
        assert.strictEqual(parseLayout(bad), undefined, JSON.stringify(bad));
      }
    });
  });

  suite('toSaved and toLayout', () => {
    test('sizes become proportions of each parent, nested too', () => {
      assert.deepStrictEqual(toSaved(parseLayout(live())!), {
        orientation: 0,
        groups: [{ size: 0.4 }, { size: 0.3 }, { size: 0.3, groups: [{ size: 0.75 }, { size: 0.25 }] }],
      });
    });

    test('the layout to apply carries the proportions and no labels', () => {
      const saved = attachLabels(toSaved(parseLayout(live())!), ['A', 'B', 'C', 'D']);
      assert.deepStrictEqual(toLayout(saved), {
        orientation: 0,
        groups: [{ size: 0.4 }, { size: 0.3 }, { size: 0.3, groups: [{ size: 0.75 }, { size: 0.25 }] }],
      });
    });
  });

  suite('sameShape', () => {
    const grid = toSaved(parseLayout(live())!);

    test('ignores sizes and labels', () => {
      assert.ok(sameShape(grid, parseLayout({ ...live(), groups: [{ size: 1 }, { size: 1 }, { size: 9, groups: [{ size: 1 }, { size: 1 }] }] })!));
      assert.ok(sameShape(grid, attachLabels(grid, ['A', 'B', 'C', 'D'])));
    });

    test('differs by the number of groups, the orientation, or a nested split', () => {
      const fewer = parseLayout({ orientation: 0, groups: [{ size: 1 }, { size: 1 }, { size: 1 }] })!;
      const flipped = parseLayout({ ...live(), orientation: 1 })!;
      const deeper = parseLayout({
        orientation: 0,
        groups: [{ size: 1 }, { size: 1 }, { size: 1, groups: [{ size: 1 }, { size: 1, groups: [{ size: 1 }, { size: 1 }] }] }],
      })!;
      for (const other of [fewer, flipped, deeper]) assert.ok(!sameShape(grid, other));
    });

    test('a single group is a shape of its own', () => {
      const one = parseLayout({ orientation: 0, groups: [{ size: 1 }] })!;
      assert.strictEqual(leafCount(one), 1);
      assert.ok(!sameShape(grid, one));
    });
  });

  suite('attachLabels', () => {
    test('labels the cells in reading order, and leaves a mismatched count unlabelled', () => {
      const grid = toSaved(parseLayout(live())!);
      const labelled = attachLabels(grid, ['Claude Code', 'Codex', 'Terminal', '']);
      assert.deepStrictEqual(labelled.groups[0], { size: 0.4, label: 'Claude Code' });
      assert.deepStrictEqual(labelled.groups[2].groups, [{ size: 0.75, label: 'Terminal' }, { size: 0.25 }]);
      assert.deepStrictEqual(attachLabels(grid, ['only one']), grid);
    });
  });

  suite('parseSavedGrid', () => {
    test('accepts a saved grid, labels included', () => {
      const saved = attachLabels(toSaved(parseLayout(live())!), ['A', 'B', 'C', 'D']);
      assert.deepStrictEqual(parseSavedGrid(saved, () => undefined), saved);
    });

    test('nothing saved gives no grid and no log line', () => {
      const logs: string[] = [];
      for (const empty of [undefined, {}]) assert.strictEqual(parseSavedGrid(empty, (l) => logs.push(l)), undefined);
      assert.deepStrictEqual(logs, []);
    });

    test('a value that does not fit is ignored as a whole and logged', () => {
      const logs: string[] = [];
      for (const bad of [5, 'x', [], { orientation: 0 }, { orientation: 0, groups: [{ size: 0.5 }, { size: -1 }] }]) {
        assert.strictEqual(parseSavedGrid(bad, (l) => logs.push(l)), undefined, JSON.stringify(bad));
      }
      assert.strictEqual(logs.length, 5);
    });
  });

  suite('maxDifference', () => {
    test('is the largest gap in any parent, and ignores the scale', () => {
      const a = parseLayout(live())!;
      assert.strictEqual(maxDifference(a, toSaved(a)), 0);
      const other = parseLayout({ ...live(), groups: [{ size: 500 }, { size: 300 }, { size: 200, groups: [{ size: 400 }, { size: 400 }] }] })!;
      assert.ok(Math.abs(maxDifference(a, other) - 0.25) < 1e-9);
    });
  });
});
