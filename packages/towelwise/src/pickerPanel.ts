import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { isActive } from './hyperspace';
import { holdLayoutSaves } from './layoutPanel';
import { Draft, SaveResult, liveLayoutEnv, pageHtml, parseMessage } from './picker';

// One panel at a time. Its draft lives here, so hiding the panel keeps it and closing the panel drops it.
let current: { panel: vscode.WebviewPanel } | undefined;

// The tests pass a stand-in panel and draft.
export function openPicker(
  context: vscode.ExtensionContext,
  storageDir: string,
  createPanel: (media: vscode.Uri) => vscode.WebviewPanel = (media) =>
    vscode.window.createWebviewPanel('towelwise.hyperspace.edit', 'Edit Hyperspace Layout', vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [media],
    }),
  makeDraft = () => new Draft(undefined, undefined, undefined, { read: liveLayoutEnv.read, hold: holdLayoutSaves }),
): void {
  if (current) {
    current.panel.reveal();
    return;
  }

  const media = vscode.Uri.joinPath(context.extensionUri, 'media');
  const panel = createPanel(media);
  current = { panel };
  const draft = makeDraft();
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
      grid: draft.gridView(),
      layoutSaved: draft.layoutSaved(),
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
          case 'useCurrentLayout':
            await draft.useCurrentLayout();
            await send();
            break;
          case 'clearGrid':
            await draft.clearGrid();
            await send();
            break;
          case 'chooseLayout':
            await vscode.commands.executeCommand('towelwise.layout.choose');
            break;
          case 'size':
            await draft.setSize(message.part, message.value);
            await send();
            break;
          case 'save': {
            // A save that throws is shown on the page like a failed write, so the result unlocks the page's fields.
            const result = await draft.save().catch((e: unknown): SaveResult => ({ written: [], failed: { option: 'hyperspace', message: e instanceof Error ? e.message : String(e) } }));
            // A failure, a choice dropped because the layout now uses it, or an edit made while it wrote stays on the page.
            const stale = draft.unsaved();
            if (result.failed || result.skipped || stale) await send({ result: { ...result, ...(stale && { stale }) } });
            else panel.dispose();
            break;
          }
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
