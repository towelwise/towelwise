import * as vscode from 'vscode';
import { isActive, restore, toggle } from './hyperspace';
import { applyOnStartup, chooseLayout, liveVsCode, restoreLayout } from './layout';

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
    vscode.commands.registerCommand('towelwise.layout.choose', () => chooseLayout().catch(showError)),
    vscode.commands.registerCommand('towelwise.layout.restore', async () => {
      try {
        const { ran, skipped } = await restoreLayout(await liveVsCode());
        if (ran.length + skipped.length === 0) {
          void vscode.window.showInformationMessage('Towelwise: no layout chosen yet. Run Towelwise: Choose Layout.');
        } else if (skipped.length > 0) {
          void vscode.window.showInformationMessage(`Towelwise: skipped ${skipped.join(', ')}, which is not available.`);
        }
      } catch (e) {
        showError(e);
      }
    }),
  );

  // Quiet on purpose: a missing agent should not nag on every window open.
  void applyOnStartup(storageDir, liveVsCode).then(undefined, showError);

  if (isActive(storageDir)) {
    void vscode.window
      .showInformationMessage('Towelwise: hyperspace is still on. Restore your settings?', 'Restore')
      .then(async (choice) => {
        if (choice === 'Restore' && !(await restore(storageDir))) {
          void vscode.window.showInformationMessage(
            'Towelwise: another window is switching hyperspace right now. Run Jump to Hyperspace again in a moment.',
          );
        }
      })
      .then(undefined, showError);
  }
}

export function deactivate(): void {}
