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

  test('a redraw keeps what is typed in the focused field and has not been sent yet', () => {
    // Just enough of a page to run the script: nodes that hold children, a key, a value and the focus.
    class Fake {
      children: Fake[] = [];
      dataset: Record<string, string> = {};
      style: Record<string, string> = {};
      value = '';
      type = '';
      selectionStart = 0;
      selectionEnd = 0;
      constructor(readonly tagName: string) {}
      append(...nodes: Fake[]) {
        this.children.push(...nodes);
      }
      replaceChildren(...nodes: Fake[]) {
        this.children = nodes;
      }
      setAttribute() {}
      addEventListener() {}
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
    new Function('acquireVsCodeApi', 'document', 'window', media('layout.js'))(() => ({ postMessage: () => undefined }), doc, win);

    const state = (percent: string) => ({ type: 'state', agents: [], grid: { on: false }, sizes: { available: true, rows: [{ part: 'sidebar', label: 'Side bar', percent }] } });
    onMessage!({ data: state('20') });
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
