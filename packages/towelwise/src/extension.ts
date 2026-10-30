import * as vscode from 'vscode';
import { isActive, restore, toggle } from './hyperspace';

export function activate(context: vscode.ExtensionContext): void {
  // globalStorage is one folder shared by every window, so hyperspace is a single shared state.
  const storageDir = context.globalStorageUri.fsPath;

  context.subscriptions.push(
    vscode.commands.registerCommand('towelwise.hyperspace.toggle', async () => {
      const blocked = await toggle(storageDir);
      if (blocked.length > 0) {
        void vscode.window.showInformationMessage(
          `Hyperspace could not hide everything: a workspace setting overrides ${blocked.join(', ')}.`,
        );
      }
    }),
  );

  if (isActive(storageDir)) {
    void vscode.window
      .showInformationMessage('Towelwise: hyperspace is still on. Restore your settings?', 'Restore')
      .then((choice) => (choice === 'Restore' ? restore(storageDir) : undefined));
  }
}

export function deactivate(): void {}
