import * as vscode from 'vscode';
import { isActive, restore, toggle } from './hyperspace';
import { applyOnStartup, chooseLayout, liveVsCode, restoreLayout } from './layout';
import { LayoutMode } from './layoutMode';
import { Draft } from './picker';
import { openPicker } from './pickerPanel';

// Registered by the Towelwise AI workbench patch.
const ENTER_LAYOUT_MODE = 'towelwise.layoutMode.enter';

const showError = (e: unknown) => void vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));

export function activate(context: vscode.ExtensionContext): void {
  // globalStorage is one folder shared by every window, so hyperspace is a single shared state.
  const storageDir = context.globalStorageUri.fsPath;
  // A quiet record of what Restore ran, since VS Code cannot say whether a command had any visible effect.
  const channel = vscode.window.createOutputChannel('Towelwise');
  const log = (line: string) => channel.appendLine(`${new Date().toISOString()} ${line}`);
  context.subscriptions.push(channel);
  const layoutMode = new LayoutMode(() => new Draft(), () => isActive(storageDir));

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
    vscode.commands.registerCommand('towelwise.hyperspace.edit', () => openPicker(context, storageDir)),
    vscode.commands.registerCommand('towelwise.layoutMode.open', async () => {
      layoutMode.open();
      // The boxes are drawn by the Towelwise AI workbench patch; plain VS Code has no such command.
      if ((await vscode.commands.getCommands(true)).includes(ENTER_LAYOUT_MODE)) {
        await vscode.commands.executeCommand(ENTER_LAYOUT_MODE);
      } else {
        void vscode.window.showInformationMessage('Towelwise: Layout Mode needs Towelwise AI. In other editors, use Edit Hyperspace Layout.');
      }
    }),
    // Called by the patch, not listed in the palette.
    vscode.commands.registerCommand('towelwise.layoutMode.state', () => layoutMode.state()),
    vscode.commands.registerCommand('towelwise.layoutMode.choose', (option: unknown, value: unknown) => layoutMode.choose(option, value)),
    vscode.commands.registerCommand('towelwise.layoutMode.save', () => layoutMode.save()),
    vscode.commands.registerCommand('towelwise.layoutMode.close', () => layoutMode.close()),
    vscode.commands.registerCommand('towelwise.layout.choose', () => chooseLayout().catch(showError)),
    vscode.commands.registerCommand('towelwise.layout.restore', async () => {
      try {
        const { ran, skipped } = await restoreLayout(await liveVsCode(log));
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
  void applyOnStartup(storageDir, () => liveVsCode(log)).then(undefined, showError);

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
