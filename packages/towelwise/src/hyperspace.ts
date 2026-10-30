import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { withLock } from './lock';

interface Saved {
  key: string;
  had: boolean;
  value?: unknown;
}

// fullScreen records that the jump toggled full screen in the window windowId, so only that window toggles it back.
interface Snapshot {
  settings: Saved[];
  fullScreen: boolean;
  windowId?: string;
}

// The window running a transition: its id (new on every start) and how it runs VS Code commands.
// A parameter only so tests can stand in for other windows and observe or fail commands.
interface Host {
  windowId: string;
  run(command: string): PromiseLike<unknown>;
}

const DEFAULT_HOST: Host = { windowId: randomUUID(), run: (command) => vscode.commands.executeCommand(command) };

// VS Code only offers a toggle and cannot report the current state, so this is opt-in and assumes the window starts windowed.
const TOGGLE_FULL_SCREEN = 'workbench.action.toggleFullScreen';

// `option` is the towelwise.hyperspace.* setting that turns each item on or off.
const CHROME = [
  { option: 'hideActivityBar', key: 'workbench.activityBar.location', hidden: 'hidden' },
  { option: 'hideStatusBar', key: 'workbench.statusBar.visible', hidden: false },
  { option: 'hideMenuBar', key: 'window.menuBarVisibility', hidden: 'hidden' },
];

// Close commands are no-ops on an area that is already closed, so they never open anything.
// The editor area is deliberately absent: VS Code only offers a blind toggle for it.
const AREAS = [
  { option: 'hidePrimarySideBar', command: 'workbench.action.closeSidebar' },
  { option: 'hideSecondarySideBar', command: 'workbench.action.closeAuxiliaryBar' },
  { option: 'hideBottomPanel', command: 'workbench.action.closePanel' },
];

const GLOBAL = vscode.ConfigurationTarget.Global;
export const stateFile = (storageDir: string) => path.join(storageDir, 'hyperspace.json');

export const isActive = (storageDir: string) => fs.existsSync(stateFile(storageDir));

/** Jumps or restores. Returns the settings a workspace override kept from being hidden. */
export function toggle(storageDir: string, host = DEFAULT_HOST): Promise<string[]> {
  return withLock(
    storageDir,
    async () => {
      if (isActive(storageDir)) {
        await restoreSnapshot(storageDir, host);
        return [];
      }
      try {
        return await jump(storageDir, host);
      } catch (e) {
        // Undo the partial jump, so the next press jumps instead of "restoring" nothing. If the undo fails too,
        // the saved copy stays and a later restore can retry; the original error is the one to report.
        await restoreSnapshot(storageDir, host).catch(() => undefined);
        throw e;
      }
    },
    [],
  );
}

/** Restores the saved settings. Resolves false, changing nothing, if another window is mid-transition. */
export function restore(storageDir: string, host = DEFAULT_HOST): Promise<boolean> {
  return withLock(
    storageDir,
    async () => {
      await restoreSnapshot(storageDir, host);
      return true;
    },
    false,
  );
}

// Written to a temp file and renamed, so a crash never leaves a half-written snapshot.
function publish(storageDir: string, snapshot: Snapshot): void {
  const file = stateFile(storageDir);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(snapshot));
  fs.renameSync(`${file}.tmp`, file);
}

async function jump(storageDir: string, host: Host): Promise<string[]> {
  const config = vscode.workspace.getConfiguration();
  const options = vscode.workspace.getConfiguration('towelwise.hyperspace');
  const chrome = CHROME.filter((c) => options.get<boolean>(c.option));
  const settings: Saved[] = chrome.map(({ key }) => {
    const value = config.inspect(key)?.globalValue;
    return { key, had: value !== undefined, value };
  });
  const snapshot: Snapshot = { settings, fullScreen: false, windowId: host.windowId };

  // Published first, so a crash mid-jump stays recoverable.
  publish(storageDir, snapshot);

  for (const { key, hidden } of chrome) {
    await config.update(key, hidden, GLOBAL);
  }
  for (const { option, command } of AREAS) {
    if (options.get<boolean>(option)) {
      await host.run(command);
    }
  }
  if (options.get<boolean>('fullScreen')) {
    await host.run(TOGGLE_FULL_SCREEN);
    // Recorded only once the toggle succeeded, so restore never toggles a window that did not enter full screen.
    publish(storageDir, { ...snapshot, fullScreen: true });
  }
  // A fresh read: `config` above is a snapshot taken before the updates.
  const after = vscode.workspace.getConfiguration();
  return chrome.filter(({ key, hidden }) => after.get(key) !== hidden).map(({ key }) => key);
}

function readSnapshot(file: string): Snapshot {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    const known = (s: Saved) =>
      typeof s?.key === 'string' && typeof s.had === 'boolean' && CHROME.some((c) => c.key === s.key);
    // A bare array is the previous version's format: settings only, no full screen.
    const snapshot = (Array.isArray(data) ? { settings: data, fullScreen: false } : data) as Snapshot;
    if (!Array.isArray(snapshot?.settings) || !snapshot.settings.every(known) || typeof snapshot.fullScreen !== 'boolean') {
      throw new Error('invalid snapshot');
    }
    return snapshot;
  } catch {
    fs.rmSync(file, { force: true });
    throw new Error('Hyperspace state was unreadable, so it was cleared. No settings were restored.');
  }
}

async function restoreSnapshot(storageDir: string, host: Host): Promise<void> {
  const file = stateFile(storageDir);
  const { settings, fullScreen, windowId } = readSnapshot(file);
  const config = vscode.workspace.getConfiguration();
  for (const s of settings) {
    await config.update(s.key, s.had ? s.value : undefined, GLOBAL);
  }
  // Cleared before the toggle: a failure here leaves a window the user can fix with F11, never a stuck hyperspace.
  fs.rmSync(file);
  if (!fullScreen) return;
  // Full screen belongs to one window and VS Code toggles whichever window is active, so only the jumper toggles it back.
  if (windowId === host.windowId) await host.run(TOGGLE_FULL_SCREEN);
  else {
    void vscode.window.showInformationMessage(
      'Towelwise: your settings are restored. The window that jumped is still full screen; press F11 there to leave it.',
    );
  }
}
