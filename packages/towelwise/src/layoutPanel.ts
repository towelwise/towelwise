import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { LayoutDraft, LayoutEnv, SaveResult, parseLayoutMessage } from './layoutDraft';
import { liveEditors } from './liveEditors';
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

// True from the moment the page closes itself for a restore until the page is back. Nothing else opens a page
// meanwhile: the restore brings this draft back, and a second page would take its place and lose it.
let restoring = false;

// What the page needs from VS Code, so tests can stand in for the window.
export interface PageHost {
  createPanel(media: vscode.Uri): vscode.WebviewPanel;
  run(command: string): Thenable<unknown>;
  keepEmptyGroups<T>(work: () => Promise<T>): Promise<T>;
  wait(ms: number): Promise<void>;
}

const liveHost: PageHost = {
  createPanel: (media) =>
    vscode.window.createWebviewPanel('towelwise.layout.choose', 'Choose Layout', vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [media],
    }),
  run: (command) => vscode.commands.executeCommand(command),
  keepEmptyGroups: (work) => liveEditors.keepEmptyGroups(work),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Closes the page if it is open (the tests use this to leave no window behind). */
export function closeLayoutPage(): void {
  current?.panel.dispose();
}

// `kept` is a draft carried over from a page that closed itself for a restore (see 'restore' below).
export function openLayoutPage(
  context: vscode.ExtensionContext,
  log: (line: string) => void,
  kept?: LayoutDraft,
  host: PageHost = liveHost,
): void {
  if (restoring) return;
  if (current) {
    current.panel.reveal();
    return;
  }

  const media = vscode.Uri.joinPath(context.extensionUri, 'media');
  const panel = host.createPanel(media);
  current = { panel };
  const draft = kept ?? new LayoutDraft(readSaved(log), liveEnv);
  const uri = (file: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(media, file)).toString();
  panel.webview.html = pageHtml({
    cspSource: panel.webview.cspSource,
    nonce: randomBytes(16).toString('hex'),
    scriptUri: uri('layout.js'),
    styleUri: uri('layout.css'),
    title: 'Choose Layout',
  });

  // The page opens as a tab in the active group, then moves to its own window so it does not sit among
  // (or split) the editor groups the layout is about. If the move fails, the page stays where it is. The page
  // may be the only tab in an empty group, and VS Code closes a group when its last tab leaves, which would
  // remove a column the person set up; empty groups are held open for the move.
  void host
    .keepEmptyGroups(async () => host.run('workbench.action.moveEditorToNewWindow'))
    .then(undefined, (e: unknown) =>
      log(`Choose Layout could not move to its own window: ${e instanceof Error ? e.message : String(e)}`),
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
            // Restore moves focus between editor groups, which acts on the window that has focus. From this
            // page's own window it would rearrange the page, so the page closes first, the restore runs in
            // the main window, and the page comes back with the same unsaved draft.
            restoring = true;
            panel.dispose();
            try {
              await host.wait(300); // let focus return to the main window
              await host.run('towelwise.layout.restore');
            } finally {
              restoring = false;
              openLayoutPage(context, log, draft, host);
            }
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
  panel.onDidDispose(
    () => {
      if (current?.panel === panel) current = undefined;
    },
    undefined,
    context.subscriptions,
  );
}
