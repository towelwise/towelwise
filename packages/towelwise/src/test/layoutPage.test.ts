import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pageHtml } from '../picker';

// out/test -> the package root, where media/ lives.
const media = (file: string) => fs.readFileSync(path.join(__dirname, '..', '..', 'media', file), 'utf8');

// Every message type the page can send; the extension must understand each (parseLayoutMessage is tested separately).
const KNOWN = [
  'ready',
  'save',
  'cancel',
  'restore',
  'reload',
  'useCurrentSizes',
  'useColumns',
  'removeColumns',
  'startOver',
  'place',
  'addColumn',
  'removeColumn',
  'addRow',
  'removeRow',
  'drag',
  'assign',
  'terminal',
  'size',
];

suite('choose layout page', () => {
  test('uses the same locked-down page as the hyperspace one, with its own title and files', () => {
    const html = pageHtml({
      cspSource: 'vscode-webview://abc',
      nonce: 'n0nce',
      scriptUri: 'vscode-webview://abc/layout.js',
      styleUri: 'vscode-webview://abc/layout.css',
      title: 'Choose Layout',
    });
    assert.match(html, /<title>Choose Layout<\/title>/);
    assert.match(html, /default-src 'none'/);
    assert.match(html, /<script nonce="n0nce" src="vscode-webview:\/\/abc\/layout\.js">/);
    assert.ok(!/https?:\/\//.test(html));
  });

  test('the hyperspace page keeps its title when none is given', () => {
    const html = pageHtml({ cspSource: 'c', nonce: 'n', scriptUri: 's', styleUri: 'y' });
    assert.match(html, /<title>Edit Hyperspace Layout<\/title>/);
  });

  test('the script builds the page from text only, loads nothing, and sends only messages the extension knows', () => {
    const script = media('layout.js');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function|document\.write/.test(script), 'markup or code from a string');
    assert.ok(!/https?:\/\/|fetch\(|XMLHttpRequest|import\(/.test(script), 'the script reaches for the network');
    const sent = new Set([...script.matchAll(/type: '([A-Za-z]+)'/g)].map((m) => m[1]));
    sent.delete('state');
    for (const type of sent) assert.ok(KNOWN.includes(type), `unknown message type ${type}`);
    for (const type of KNOWN) assert.ok(sent.has(type), `never sent: ${type}`);
  });

  // Just enough of a page to run a page script: nodes that hold children, a key, a value, the focus, clicks,
  // disabling and edge drags on a 100 by 100 box. querySelectorAll answers only '[data-key]', the one selector the
  // scripts use.
  function runPage(file: string) {
    class Fake {
      children: Fake[] = [];
      parentElement: Fake | undefined;
      className = '';
      dataset: Record<string, string> = {};
      style: Record<string, string> = {};
      listeners: Record<string, (e?: object) => void> = {};
      value = '';
      type = '';
      disabled = false;
      selectionStart = 0;
      selectionEnd = 0;
      classList = { add() {}, remove() {}, contains: (c: string) => this.className.split(' ').includes(c) };
      constructor(readonly tagName: string) {}
      append(...nodes: Fake[]) {
        for (const n of nodes) n.parentElement = this;
        this.children.push(...nodes);
      }
      replaceChildren(...nodes: Fake[]) {
        this.children = [];
        this.append(...nodes);
      }
      setAttribute() {}
      addEventListener(type: string, fn: (e?: object) => void) {
        this.listeners[type] = fn;
      }
      removeEventListener(type: string) {
        delete this.listeners[type];
      }
      fire(type: string, e: object = {}) {
        this.listeners[type]?.({ preventDefault() {}, pointerId: 1, ...e });
      }
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 100, height: 100 };
      }
      setPointerCapture() {}
      all(): Fake[] {
        return this.children.flatMap((c) => [c, ...c.all()]);
      }
      click() {
        if (!this.disabled) this.listeners.click?.();
      }
      focus() {
        doc.activeElement = this;
      }
      setSelectionRange(from: number, to: number) {
        [this.selectionStart, this.selectionEnd] = [from, to];
      }
      querySelectorAll(): Fake[] {
        return this.children.flatMap((c) => [...(c.dataset.key ? [c] : []), ...c.querySelectorAll()]);
      }
    }
    const app = new Fake('div');
    const doc = { activeElement: undefined as Fake | undefined, getElementById: () => app, createElement: (tag: string) => new Fake(tag), createTextNode: () => new Fake('#text') };
    let onMessage: ((e: { data: unknown }) => void) | undefined;
    const win = { addEventListener: (_: string, fn: typeof onMessage) => (onMessage = fn) };
    const sent: unknown[] = [];
    new Function('acquireVsCodeApi', 'document', 'window', media(file))(() => ({ postMessage: (m: unknown) => void sent.push(m) }), doc, win);
    const key = (k: string) => app.querySelectorAll().find((n) => n.dataset.key === k)!;
    return { app, doc, sent, key, show: (state: unknown) => onMessage!({ data: state }) };
  }

  // A terminal cell, so the lock below is checked on the terminal's text fields too.
  const terminalGrid = {
    on: true,
    columns: [
      {
        size: 1,
        rows: [
          {
            size: 1,
            holds: 'terminal',
            choices: [{ value: 'terminal', label: 'Terminal' }],
            terminal: { shells: [{ value: 'default', label: 'Default' }], shell: 'default', name: '', folder: '', command: '', placeholder: 'Terminal' },
          },
        ],
      },
    ],
  };
  const pages = [
    {
      file: 'layout.js',
      state: { type: 'state', agents: [], grid: terminalGrid, sizes: { available: true, rows: [{ part: 'sidebar', label: 'Side bar', percent: '20' }] } },
      fields: ['size-sidebar', 'terminal-name-0-0', 'terminal-folder-0-0', 'terminal-command-0-0', 'terminal-shell-0-0'],
      result: { ok: true, stale: true },
    },
    {
      file: 'picker.js',
      state: {
        type: 'state',
        items: [
          { option: 'hideActivityBar', label: 'Activity bar', kind: 'chrome', choice: 'hide' },
          { option: 'fullScreen', label: 'Full screen', kind: 'switch', on: false },
        ],
        saved: [],
        sizes: { available: true, rows: [{ part: 'sidebar', label: 'Side bar', percent: 20 }] },
        names: {},
        layoutSaved: false,
        hyperspaceOn: false,
      },
      fields: ['size-sidebar', 'hideActivityBar', 'fullScreen'],
      result: { written: [], failed: { option: 'hyperspace', message: 'disk full' } },
    },
  ];
  for (const page of pages) {
    test(`${page.file}: while Save runs only Cancel works, through redraws, until a Save result arrives`, () => {
      const p = runPage(page.file);
      p.show(page.state);
      p.key('save').click();
      assert.deepStrictEqual(p.sent.at(-1), { type: 'save' });
      const unlocked = () => p.app.querySelectorAll().filter((n) => !n.disabled).map((n) => n.dataset.key);
      assert.deepStrictEqual(unlocked(), ['cancel'], 'every control but Cancel is locked, so no text can be typed that would miss the save');
      for (const field of page.fields) assert.ok(p.key(field), `the page has ${field}`);
      p.key('save').click();
      assert.strictEqual(p.sent.filter((m) => (m as { type: string }).type === 'save').length, 1, 'a second Save is not sent');

      p.show(page.state); // a redraw that is not a Save result, such as the shells being found
      assert.deepStrictEqual(unlocked(), ['cancel'], 'still locked after a redraw');

      p.show({ ...page.state, result: page.result });
      for (const field of page.fields) assert.strictEqual(p.key(field).disabled, false, `${field} is unlocked by the result`);
      assert.strictEqual(p.key('save').disabled, false);
    });
  }

  for (const [split, axis, move] of [
    ['vsplit', 'column', { clientX: 70 }],
    ['hsplit', 'row', { clientY: 70 }],
  ] as const) {
    test(`layout.js: a ${axis} edge cannot be dragged while Save runs, and a drag held when Save is pressed is sent first`, () => {
      const cell = terminalGrid.columns[0].rows[0];
      const state = { ...pages[0].state, grid: { on: true, columns: [{ size: 0.5, rows: [{ ...cell, size: 0.5 }, { ...cell, size: 0.5 }] }, { size: 0.5, rows: [cell] }] } };
      const drags = (p: ReturnType<typeof runPage>) => p.sent.filter((m) => (m as { type: string }).type === 'drag');

      const locked = runPage('layout.js');
      locked.show(state);
      locked.key('save').click();
      const edge = locked.app.all().find((n) => n.className === split)!;
      edge.fire('pointerdown');
      edge.fire('pointermove', move);
      edge.fire('pointerup');
      assert.deepStrictEqual(drags(locked), [], 'no drag starts while Save runs');

      const held = runPage('layout.js');
      held.show(state);
      const heldEdge = held.app.all().find((n) => n.className === split)!;
      heldEdge.fire('pointerdown');
      heldEdge.fire('pointermove', move);
      held.key('save').click(); // Enter on a focused Save, with the mouse still down
      assert.deepStrictEqual(held.sent.slice(-2).map((m) => (m as { type: string }).type), ['drag', 'save'], 'the drag reaches the extension before the save');
      assert.ok(Math.abs((drags(held)[0] as { size: number }).size - 0.7) < 1e-9);
      heldEdge.fire('pointerup');
      assert.strictEqual(drags(held).length, 1, 'letting go afterwards sends nothing more');
    });
  }

  test('a redraw keeps what is typed in the focused field and has not been sent yet', () => {
    const { app, doc, show } = runPage('layout.js');
    const onMessage = ({ data }: { data: unknown }) => show(data);
    const state = (percent: string) => ({ type: 'state', agents: [], grid: { on: false }, sizes: { available: true, rows: [{ part: 'sidebar', label: 'Side bar', percent }] } });
    onMessage({ data: state('20') });
    const field = () => app.querySelectorAll().find((n) => n.dataset.key === 'size-sidebar')!;
    field().focus();
    field().value = '2';
    field().setSelectionRange(1, 1);
    onMessage!({ data: state('20') });
    assert.strictEqual(doc.activeElement, field());
    assert.strictEqual(field().value, '2', 'the unfinished text is still there');
    assert.strictEqual(field().selectionStart, 1);
  });

  test('the style sheet loads nothing from outside', () => {
    assert.ok(!/url\(|@import|https?:\/\//.test(media('layout.css')));
  });
});
