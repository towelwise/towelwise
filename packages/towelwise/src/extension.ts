import * as os from 'node:os';
import * as vscode from 'vscode';
import { isActive, restore, setLog, toggle } from './hyperspace';
import { applyOnStartup, liveVsCode, restoreLayout } from './layout';
import { openLayoutPage } from './layoutPanel';
import { AGENTS } from './agents';
import { keepHoldRecordIn, liveEditors, recoverHeldSetting } from './liveEditors';
import { applyLayoutLocked, closeAgentTabs, liveHost, readLayout } from './myLayout';
import { logMenuProblems } from './menuEntries';
import { openPicker } from './pickerPanel';
import { available, detectMachine, launch, SHELL_KEYS, ShellKey, startDir } from './shells';

const showError = (e: unknown) => void vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));

export function activate(context: vscode.ExtensionContext): void {
  // globalStorage is one folder shared by every window, so hyperspace is a single shared state.
  const storageDir = context.globalStorageUri.fsPath;
  // A quiet record of what Restore ran, since VS Code cannot say whether a command had any visible effect.
  const channel = vscode.window.createOutputChannel('Towelwise');
  const log = (line: string) => channel.appendLine(`${new Date().toISOString()} ${line}`);
  setLog(log);
  context.subscriptions.push(channel);

  // The Towelwise menu is drawn by the IDE from this setting; a mistake in it is named here, not silent.
  const checkMenuSetting = () => logMenuProblems(vscode.workspace.getConfiguration('towelwise.menus').get('towelwise'), log);
  checkMenuSetting();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('towelwise.menus.towelwise')) checkMenuSetting();
    }),
  );

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
    vscode.commands.registerCommand('towelwise.layout.choose', () => openLayoutPage(context, log)),
    vscode.commands.registerCommand('towelwise.layout.restore', async () => {
      try {
        const mine = readLayout(log);
        if (mine) {
          const outcome = await applyLayoutLocked(storageDir, liveHost(storageDir, log, liveEditors), mine);
          if (outcome === 'busy') {
            void vscode.window.showInformationMessage('Towelwise: another restore or jump is running right now. Try again in a moment.');
            return;
          }
          if (outcome.refused) {
            void vscode.window.showInformationMessage('Towelwise: leave hyperspace first, then restore your layout.');
          } else if (outcome.problems.length > 0) {
            void vscode.window.showInformationMessage(`Towelwise: your layout is applied, except: ${outcome.problems.join('; ')}.`);
          }
          // Nothing is closed for the person: they are told, and may close the second copy with one press.
          if (outcome.openAsTab.length > 0) {
            const names = outcome.openAsTab.map((id) => AGENTS[id].label).join(' and ');
            void vscode.window.showInformationMessage(`Towelwise: ${names} also open${outcome.openAsTab.length > 1 ? '' : 's'} as an editor tab.`, 'Close it').then(async (choice) => {
              if (choice !== 'Close it') return;
              for (const id of outcome.openAsTab) await closeAgentTabs(liveEditors, id);
            });
          }
          return;
        }
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

  // A restore cut short (window closed, host died) can leave closeEmptyGroups off; put the user's value back.
  keepHoldRecordIn(storageDir);
  void recoverHeldSetting(storageDir, log).then(undefined, showError);

  // Quiet on purpose: a missing agent should not nag on every window open.
  void applyOnStartup(storageDir, () => liveVsCode(log), log).then(undefined, showError);

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
