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

  test('the style sheet loads nothing from outside', () => {
    assert.ok(!/url\(|@import|https?:\/\//.test(media('layout.css')));
  });
});
