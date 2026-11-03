import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { isActive } from './hyperspace';
import { Draft, pageHtml, parseMessage } from './picker';

// One panel at a time. Its draft lives here, so hiding the panel keeps it and closing the panel drops it.
let current: { panel: vscode.WebviewPanel } | undefined;

export function openPicker(context: vscode.ExtensionContext, storageDir: string): void {
  if (current) {
    current.panel.reveal();
    return;
  }

  const media = vscode.Uri.joinPath(context.extensionUri, 'media');
  const panel = vscode.window.createWebviewPanel('towelwise.hyperspace.edit', 'Edit Hyperspace Layout', vscode.ViewColumn.Active, {
    enableScripts: true,
    localResourceRoots: [media],
  });
  current = { panel };
  const draft = new Draft();
  const uri = (file: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(media, file)).toString();
  panel.webview.html = pageHtml({
    cspSource: panel.webview.cspSource,
    nonce: randomBytes(16).toString('hex'),
    scriptUri: uri('picker.js'),
    styleUri: uri('picker.css'),
  });

  const send = (extra: object = {}) =>
    panel.webview.postMessage({
      type: 'state',
      items: draft.items(),
      saved: draft.savedOptions(),
      sizes: draft.sizesView(),
      names: draft.namesView(),
      hyperspaceOn: isActive(storageDir),
      ...extra,
    });

  panel.webview.onDidReceiveMessage(
    async (raw: unknown) => {
      const message = parseMessage(raw);
      if (!message) return;
      try {
        switch (message.type) {
          case 'ready':
            await draft.refreshLive();
            await send();
            break;
          case 'choose':
            draft.choose(message.option, message.choice);
            await send();
            break;
          case 'fullScreen':
            draft.setFullScreen(message.on);
            await send();
            break;
          case 'useCurrentSizes':
            await draft.useCurrentSizes();
            await send();
            break;
          case 'size':
            await draft.setSize(message.part, message.value);
            await send();
            break;
          case 'save':
            await send({ result: await draft.save() });
            break;
          case 'cancel':
            panel.dispose();
            break;
        }
      } catch (e) {
        void vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));
      }
    },
    undefined,
    context.subscriptions,
  );
  // What is open in each area may have changed while the page was hidden.
  panel.onDidChangeViewState(
    async (e) => {
      if (!e.webviewPanel.visible) return;
      try {
        await draft.refreshLive();
        await send();
      } catch {
        // Names are display only; a failed refresh keeps what the page shows.
      }
    },
    undefined,
    context.subscriptions,
  );
  panel.onDidDispose(() => (current = undefined), undefined, context.subscriptions);
}
