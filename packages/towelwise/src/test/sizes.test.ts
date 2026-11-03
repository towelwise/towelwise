import * as assert from 'node:assert';
import {
  LayoutState,
  orientationOf,
  parseLayoutState,
  parseRecorded,
  parseSizes,
  planRestore,
  planSizes,
  record,
  toProportions,
  validateTyped,
} from '../sizes';

const state = (over: Partial<LayoutState> = {}): LayoutState => ({
  window: { width: 2000, height: 1000 },
  panelPosition: 'bottom',
  parts: {
    sidebar: { visible: true, size: 300 },
    auxiliarybar: { visible: true, size: 400 },
    panel: { visible: true, size: 250 },
  },
  ...over,
});

suite('sizes', () => {
  suite('orientationOf', () => {
    test('a bottom or top panel is sized down, a left or right one across', () => {
      assert.strictEqual(orientationOf('bottom'), 'down');
      assert.strictEqual(orientationOf('top'), 'down');
      assert.strictEqual(orientationOf('left'), 'across');
      assert.strictEqual(orientationOf('right'), 'across');
    });
  });

  suite('toProportions', () => {
    test('side bars against the window width, a bottom panel against its height', () => {
      assert.deepStrictEqual(toProportions(state()), {
        sidebar: 0.15,
        auxiliarybar: 0.2,
        panel: 0.25,
        panelOrientation: 'down',
      });
    });

    test('a side panel is measured against the width and records that', () => {
      const s = state({ panelPosition: 'right', parts: { ...state().parts, panel: { visible: true, size: 500 } } });
      const p = toProportions(s);
      assert.strictEqual(p.panel, 0.25);
      assert.strictEqual(p.panelOrientation, 'across');
    });

    test('a part that is not visible is left out', () => {
      const s = state({ parts: { ...state().parts, auxiliarybar: { visible: false, size: 0 } } });
      assert.ok(!('auxiliarybar' in toProportions(s)));
    });
  });

  suite('planSizes', () => {
    const saved = { sidebar: 0.15, auxiliarybar: 0.2, panel: 0.25, panelOrientation: 'down' as const };
    const all = new Set(['sidebar', 'auxiliarybar', 'panel'] as const);

    test('converts each proportion to pixels for the current window, rounded', () => {
      const plan = planSizes(saved, state({ window: { width: 1001, height: 777 } }), all);
      assert.deepStrictEqual(plan.set, [
        { part: 'sidebar', pixels: 150 },
        { part: 'auxiliarybar', pixels: 200 },
        { part: 'panel', pixels: 194 },
      ]);
    });

    test('leaves out parts that are hidden by hyperspace, not visible, or without a saved size', () => {
      const s = state({ parts: { ...state().parts, auxiliarybar: { visible: false, size: 0 } } });
      const plan = planSizes({ sidebar: 0.15, auxiliarybar: 0.2 }, s, new Set(['auxiliarybar', 'panel'] as const));
      assert.deepStrictEqual(plan.set, []);
      assert.deepStrictEqual(plan.skipped, []);
    });

    test('skips and reports a panel whose orientation differs from the saved one', () => {
      const plan = planSizes(saved, state({ panelPosition: 'left' }), all);
      assert.ok(!plan.set.some((s) => s.part === 'panel'));
      assert.deepStrictEqual(plan.skipped, ['panel']);
    });

    test('a saved panel size without an orientation is not applied', () => {
      const plan = planSizes({ panel: 0.25 }, state(), all);
      assert.deepStrictEqual(plan.set, []);
      assert.deepStrictEqual(plan.skipped, ['panel']);
    });

    test('a side panel uses the window width', () => {
      const plan = planSizes({ panel: 0.25, panelOrientation: 'across' }, state({ panelPosition: 'right' }), all);
      assert.deepStrictEqual(plan.set, [{ part: 'panel', pixels: 500 }]);
    });
  });

  suite('parseSizes', () => {
    test('keeps valid parts and logs and drops the rest, part by part', () => {
      const bad: string[] = [];
      const parsed = parseSizes(
        { sidebar: 0.2, auxiliarybar: 'wide', panel: 0.3, panelOrientation: 'down', extra: 1 },
        (line) => bad.push(line),
      );
      assert.deepStrictEqual(parsed, { sidebar: 0.2, panel: 0.3, panelOrientation: 'down' });
      assert.strictEqual(bad.length, 1);
    });

    test('proportions outside 0 to 1 are dropped', () => {
      assert.deepStrictEqual(parseSizes({ sidebar: 0, auxiliarybar: 1.5, panel: -1 }, () => undefined), {});
    });

    test('anything that is not an object gives no sizes', () => {
      for (const value of [undefined, null, 5, 'x', []]) {
        assert.deepStrictEqual(parseSizes(value, () => undefined), {});
      }
    });

    test('an unknown orientation drops the panel size', () => {
      assert.deepStrictEqual(parseSizes({ panel: 0.3, panelOrientation: 'sideways' }, () => undefined), {});
    });
  });

  suite('validateTyped', () => {
    test('accepts typed percentages from 5 to 80 and sets nothing else', () => {
      assert.strictEqual(validateTyped({ sidebar: 5, auxiliarybar: 80 }, new Set()), undefined);
    });

    test('refuses a typed value that is non-numeric or out of range', () => {
      for (const v of [NaN, 4.9, 80.1, -1]) {
        assert.match(validateTyped({ sidebar: v }, new Set(['sidebar'])) ?? '', /5 and 80/);
      }
    });

    test('does not check captured values', () => {
      assert.strictEqual(validateTyped({ sidebar: 90, auxiliarybar: 90 }, new Set()), undefined);
    });

    test('the two side bars must leave 20 percent when at least one is typed', () => {
      assert.match(validateTyped({ sidebar: 50, auxiliarybar: 35 }, new Set(['sidebar'])) ?? '', /20/);
      assert.strictEqual(validateTyped({ sidebar: 50, auxiliarybar: 30 }, new Set(['sidebar'])), undefined);
    });

    test('the editor floor is skipped when both side bars are captured', () => {
      assert.strictEqual(validateTyped({ sidebar: 50, auxiliarybar: 49 }, new Set(['panel'])), undefined);
    });

    test('a cleared size (undefined) is allowed', () => {
      assert.strictEqual(validateTyped({ sidebar: undefined, auxiliarybar: 30 }, new Set(['sidebar'])), undefined);
    });
  });
});

suite('sizes: recording and restoring', () => {
  const live = (over: Partial<LayoutState> = {}): LayoutState => ({
    window: { width: 2000, height: 1000 },
    panelPosition: 'bottom',
    parts: {
      sidebar: { visible: true, size: 300 },
      auxiliarybar: { visible: false, size: 0 },
      panel: { visible: true, size: 250 },
    },
    ...over,
  });

  test('records only visible parts, with the panel orientation', () => {
    assert.deepStrictEqual(record(live()), { pixels: { sidebar: 300, panel: 250 }, panelOrientation: 'down' });
  });

  test('restores only parts still visible, and not a panel that turned', () => {
    const recorded = record(live());
    const now = live({ panelPosition: 'right', parts: { ...live().parts, sidebar: { visible: false, size: 0 } } });
    assert.deepStrictEqual(planRestore(recorded, now), { set: [], skipped: ['panel'] });
    assert.deepStrictEqual(planRestore(recorded, live()).set, [
      { part: 'sidebar', pixels: 300 },
      { part: 'panel', pixels: 250 },
    ]);
  });

  test('parseRecorded accepts what record gives and rejects the rest', () => {
    assert.deepStrictEqual(parseRecorded(record(live())), record(live()));
    for (const bad of [undefined, 3, {}, { pixels: { sidebar: 'x' } }, { pixels: { panel: -1 } }, { pixels: {}, panelOrientation: 'up' }]) {
      assert.strictEqual(parseRecorded(bad), undefined);
    }
  });

  test('parseLayoutState rejects anything that is not a full state', () => {
    assert.ok(parseLayoutState(live()));
    for (const bad of [undefined, null, 'x', {}, { ...live(), panelPosition: 'middle' }, { ...live(), window: { width: 0, height: 5 } }]) {
      assert.strictEqual(parseLayoutState(bad), undefined);
    }
  });

  test('parseLayoutState keeps a named container, drops a malformed one, and still works without any', () => {
    const named = live({ parts: { ...live().parts, sidebar: { visible: true, size: 300, container: { id: 'workbench.view.explorer', title: 'Explorer' } } } });
    assert.deepStrictEqual(parseLayoutState(named)?.parts.sidebar.container, { id: 'workbench.view.explorer', title: 'Explorer' });
    for (const bad of [{ id: '', title: 'x' }, { id: 'a' }, { id: 'a', title: 5 }, 'Explorer']) {
      const broken = live({ parts: { ...live().parts, sidebar: { visible: true, size: 300, container: bad as never } } });
      const parsed = parseLayoutState(broken);
      assert.ok(parsed, JSON.stringify(bad));
      assert.strictEqual(parsed?.parts.sidebar.container, undefined);
    }
    assert.ok(parseLayoutState(live()));
  });
});
