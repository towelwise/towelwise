import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

interface Saved {
  key: string;
  had: boolean;
  value?: unknown;
}

// `option` is the towelwise.hyperspace.* setting that turns each item on or off.
const CHROME = [
  { option: 'hideActivityBar', key: 'workbench.activityBar.location', hidden: 'hidden' },
  { option: 'hideStatusBar', key: 'workbench.statusBar.visible', hidden: false },
  { option: 'hideMenuBar', key: 'window.menuBarVisibility', hidden: 'hidden' },
];

// Close commands are no-ops on an area that is already closed, so they never open anything.
const AREAS = [
  { option: 'hidePrimarySideBar', command: 'workbench.action.closeSidebar' },
  { option: 'hideSecondarySideBar', command: 'workbench.action.closeAuxiliaryBar' },
  { option: 'hideBottomPanel', command: 'workbench.action.closePanel' },
];

const GLOBAL = vscode.ConfigurationTarget.Global;

export const stateFile = (storageDir: string) => path.join(storageDir, 'hyperspace.json');

export const isActive = (storageDir: string) => fs.existsSync(stateFile(storageDir));

/** Jumps or restores. Returns the settings a workspace override kept from being hidden. */
export async function toggle(storageDir: string): Promise<string[]> {
  const file = stateFile(storageDir);
  const config = vscode.workspace.getConfiguration();

  if (fs.existsSync(file)) {
    await restore(storageDir);
    return [];
  }

  const options = vscode.workspace.getConfiguration('towelwise.hyperspace');
  const chrome = CHROME.filter((c) => options.get(c.option, true));
  const snapshot: Saved[] = chrome.map(({ key }) => {
    const value = config.inspect(key)?.globalValue;
    return { key, had: value !== undefined, value };
  });
  fs.mkdirSync(storageDir, { recursive: true });
  try {
    // Written first and exclusively: a crash mid-jump stays recoverable, and a second window can't overwrite it.
    fs.writeFileSync(file, JSON.stringify(snapshot), { flag: 'wx' });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return toggle(storageDir);
    throw e;
  }

  for (const { key, hidden } of chrome) {
    await config.update(key, hidden, GLOBAL);
  }
  for (const { option, command } of AREAS) {
    if (options.get(option, option === 'hideBottomPanel')) {
      await vscode.commands.executeCommand(command);
    }
  }
  // A fresh read: `config` above is a snapshot taken before the updates.
  const after = vscode.workspace.getConfiguration();
  return chrome.filter(({ key, hidden }) => after.get(key) !== hidden).map(({ key }) => key);
}

export async function restore(storageDir: string): Promise<void> {
  const file = stateFile(storageDir);
  const saved: Saved[] = JSON.parse(fs.readFileSync(file, 'utf8'));
  const config = vscode.workspace.getConfiguration();
  for (const s of saved) {
    await config.update(s.key, s.had ? s.value : undefined, GLOBAL);
  }
  fs.rmSync(file);
}
