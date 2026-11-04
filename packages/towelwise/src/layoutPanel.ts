import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { LayoutDraft, LayoutEnv, SaveResult, parseLayoutMessage } from './layoutDraft';
import { readSaved } from './myLayout';
import { pageHtml } from './picker';
import { parseLayoutState } from './sizes';

// One page at a time. Its draft lives here, so hiding the page keeps it and closing the page drops it.
let current: { panel: vscode.WebviewPanel } | undefined;

const config = () => vscode.workspace.getConfiguration('towelwise.layout');

// The window's sizes through the core bridge, and the three layout settings in the user's settings.
const liveEnv: LayoutEnv = {
  read: async () => {
    try {
      return parseLayoutState(await vscode.commands.executeCommand('_towelwise.layout.state'));
    } catch {
      return undefined;
    }
  },
  write: async ({ agents, grid, sizes }) => {
    await config().update('agents', agents, vscode.ConfigurationTarget.Global);
    await config().update('grid', grid, vscode.ConfigurationTarget.Global);
    await config().update('sizes', sizes, vscode.ConfigurationTarget.Global);
  },
};

export function openLayoutPage(context: vscode.ExtensionContext, log: (line: string) => void): void {
  if (current) {
    current.panel.reveal();
    return;
  }

  const media = vscode.Uri.joinPath(context.extensionUri, 'media');
  const panel = vscode.window.createWebviewPanel('towelwise.layout.choose', 'Choose Layout', vscode.ViewColumn.Active, {
    enableScripts: true,
    localResourceRoots: [media],
  });
  current = { panel };
  const draft = new LayoutDraft(readSaved(log), liveEnv);
  const uri = (file: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(media, file)).toString();
  panel.webview.html = pageHtml({
    cspSource: panel.webview.cspSource,
    nonce: randomBytes(16).toString('hex'),
    scriptUri: uri('layout.js'),
    styleUri: uri('layout.css'),
    title: 'Choose Layout',
  });

  // The page opens as a tab in the active group, then moves to its own window so it does not sit among
  // (or split) the editor groups the layout is about. If the move fails, the page stays where it is.
  void Promise.resolve(vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow')).then(
    undefined,
    (e: unknown) => log(`Choose Layout could not move to its own window: ${e instanceof Error ? e.message : String(e)}`),
  );

  // A Save result is shown until the person changes something; any other update clears it.
  const send = (extra: { result?: SaveResult } = {}) =>
    panel.webview.postMessage({ type: 'state', ...draft.view(), clearResult: !extra.result, ...extra });

  panel.webview.onDidReceiveMessage(
    async (raw: unknown) => {
      const message = parseLayoutMessage(raw);
      if (!message) return;
      try {
        switch (message.type) {
          case 'ready':
            await send();
            return;
          case 'place':
            draft.setPlace(message.agent, message.place === '' ? undefined : message.place);
            break;
          case 'useColumns':
            draft.useColumns();
            break;
          case 'removeColumns':
            draft.removeColumns();
            break;
          case 'startOver':
            draft.startOver();
            break;
          case 'addColumn':
            draft.addColumn(message.side);
            break;
          case 'removeColumn':
            draft.removeColumn(message.index);
            break;
          case 'addRow':
            draft.addRow(message.column, message.row);
            break;
          case 'removeRow':
            draft.removeRow(message.column, message.row);
            break;
          case 'drag':
            draft.dragEdge(message.axis, message.column, message.axis === 'row' ? message.row : undefined, message.size);
            break;
          case 'assign':
            draft.assign(message.column, message.row, message.holds === '' ? undefined : message.holds);
            break;
          case 'size':
            await draft.setSize(message.part, message.value);
            break;
          case 'useCurrentSizes':
            await draft.useCurrentSizes();
            break;
          case 'save':
            await send({ result: await draft.save() });
            return;
          case 'restore':
            await vscode.commands.executeCommand('towelwise.layout.restore');
            return;
          case 'reload':
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
            return;
          case 'cancel':
            panel.dispose();
            return;
        }
        await send();
      } catch (e) {
        void vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));
      }
    },
    undefined,
    context.subscriptions,
  );
  panel.onDidDispose(() => (current = undefined), undefined, context.subscriptions);
}
