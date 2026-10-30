import * as vscode from 'vscode';
import { isActive, restore, toggle } from './hyperspace';

const showError = (e: unknown) => void vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));

export function activate(context: vscode.ExtensionContext): void {
  // globalStorage is one folder shared by every window, so hyperspace is a single shared state.
  const storageDir = context.globalStorageUri.fsPath;

  context.subscriptions.push(
    vscode.commands.registerCommand('towelwise.hyperspace.toggle', async () => {
      try {
        const blocked = await toggle(storageDir);
        if (blocked.length > 0) {
          void vscode.window.showInformationMessage(
            `Hyperspace could not hide everything: a workspace setting overrides ${blocked.join(', ')}.`,
          );
        }
      } catch (e) {
        showError(e);
      }
    }),
  );

  if (isActive(storageDir)) {
    void vscode.window
      .showInformationMessage('Towelwise: hyperspace is still on. Restore your settings?', 'Restore')
      .then((choice) => (choice === 'Restore' ? restore(storageDir) : undefined))
      .then(undefined, showError);
  }
}

export function deactivate(): void {}
