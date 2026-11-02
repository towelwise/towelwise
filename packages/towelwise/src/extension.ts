import * as os from 'node:os';
import * as vscode from 'vscode';
import { isActive, restore, toggle } from './hyperspace';
import { applyOnStartup, chooseLayout, liveVsCode, restoreLayout } from './layout';
import { openPicker } from './pickerPanel';
import { available, detectMachine, launch, SHELL_KEYS, ShellKey, startDir } from './shells';

const showError = (e: unknown) => void vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));

export function activate(context: vscode.ExtensionContext): void {
  // globalStorage is one folder shared by every window, so hyperspace is a single shared state.
  const storageDir = context.globalStorageUri.fsPath;
  // A quiet record of what Restore ran, since VS Code cannot say whether a command had any visible effect.
  const channel = vscode.window.createOutputChannel('Towelwise');
  const log = (line: string) => channel.appendLine(`${new Date().toISOString()} ${line}`);
  context.subscriptions.push(channel);

  // Shells in a normal window outside the IDE. Detected fresh on each use, so a shell installed later works.
  const openShell = async (key: ShellKey) => {
    try {
      const machine = await detectMachine();
      if (machine.platform !== 'win32') {
        void vscode.window.showInformationMessage('Towelwise: opening external shells is Windows-only for now.');
        return;
      }
      if (!available(machine).includes(key)) {
        void vscode.window.showInformationMessage('Towelwise: that shell is not installed on this machine.');
        return;
      }
      const dir = startDir(vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [], os.homedir());
      if ((await launch(key, dir, machine)) === 'cancelled') {
        void vscode.window.showInformationMessage('Towelwise: the administrator window was cancelled or could not open.');
      }
    } catch (e) {
      showError(e);
    }
  };
  for (const key of SHELL_KEYS) {
    context.subscriptions.push(vscode.commands.registerCommand(`towelwise.shell.${key}`, () => openShell(key)));
  }
  // The palette shows a shell only when it is installed; setContext keys drive the `when` in the manifest.
  void detectMachine().then((machine) => {
    const present = available(machine);
    for (const key of SHELL_KEYS) void vscode.commands.executeCommand('setContext', `towelwise.shell.available.${key}`, present.includes(key));
  }, showError);

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
