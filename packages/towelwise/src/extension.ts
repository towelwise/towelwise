import * as os from 'node:os';
import * as vscode from 'vscode';
import { isActive, restore, setLog, toggle } from './hyperspace';
import { applyOnStartup, liveVsCode, restoreLayout } from './layout';
import { keepWatching } from './drift';
import { keepLayoutRecordIn, openLayoutPage, recoverSavedLayout } from './layoutPanel';
import { keepHoldRecordIn, liveEditors, recoverHeldSetting, watchTabs } from './liveEditors';
import { applyLayoutLocked, applyLayoutOnStartup, closeAgentTabs, liveHost, Outcome, reportOutcome } from './myLayout';
import { readLayout } from './savedLayout';
import { hasStartupCommand } from './columns';
import { logMenuProblems } from './menuEntries';
import { openPicker } from './pickerPanel';
import { available, detectMachine, launch, SHELL_KEYS, ShellKey, startDir } from './shells';

const showError = (e: unknown) => void vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));

// The report after an apply, for Restore Layout and for a window opening alike. Nothing is closed for the person: they are
// told, and may close the second copy with one press.
const reportApplied = (outcome: Outcome): Promise<void> =>
  reportOutcome(
    outcome,
    {
      tell: (message) => void vscode.window.showInformationMessage(message),
      offer: async (message, button) => (await vscode.window.showInformationMessage(message, button)) === button,
    },
    (ids) => closeAgentTabs(liveEditors, ids),
    watchTabs,
  );

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
          void reportApplied(outcome).catch(showError);
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

  // Startup commands were withheld while the project was untrusted; they run when the layout next opens its terminals,
  // never on their own the moment trust is granted (decision 0006).
  context.subscriptions.push(
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      if (hasStartupCommand(readLayout(log)?.grid)) {
        void vscode.window.showInformationMessage('Towelwise: this project is trusted now. Your terminals will run their startup commands after you reload the window.');
      }
    }),
  );

  // A restore or a save cut short (window closed, host died) can leave closeEmptyGroups off or the layout settings half
  // written; put the user's values back. One after another: each takes the cross-window lock, and the last reads the layout.
  keepHoldRecordIn(storageDir);
  keepLayoutRecordIn(storageDir);
  void (async () => {
    await recoverHeldSetting(storageDir, log).catch(showError);
    await recoverSavedLayout(storageDir, vscode.workspace.getConfiguration('towelwise.layout'), log).catch(showError);
    // The old container list is quiet on purpose; a saved layout reports what it could not place, as Restore Layout does.
    const mine = readLayout(log);
    if (mine) await applyLayoutOnStartup(storageDir, liveHost(storageDir, log, liveEditors), mine, (outcome) => void reportApplied(outcome).catch(showError)).catch(showError);
    else await applyOnStartup(storageDir, () => liveVsCode(log)).catch(showError);
    // Only now, so the first look at the window is after the layout was applied.
    await keepWatching(storageDir, context, log).catch(showError);
  })();

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
