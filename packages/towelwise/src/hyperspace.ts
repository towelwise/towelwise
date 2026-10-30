import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

interface Saved {
  key: string;
  had: boolean;
  value?: unknown;
}

// fullScreen records that the jump toggled full screen, so restore toggles it back and never otherwise.
interface Snapshot {
  settings: Saved[];
  fullScreen: boolean;
}

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
// shortcut: a lock this old is treated as abandoned even if its pid is alive (pid reuse after a crash); raise it if a transition can run longer.
const MAX_LOCK_AGE_MS = 60 * 60 * 1000;
const LOCK_NAME = /^hyperspace\.lock\.[\w-]+$/;

export const stateFile = (storageDir: string) => path.join(storageDir, 'hyperspace.json');

export const isActive = (storageDir: string) => fs.existsSync(stateFile(storageDir));

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function lockIsLive(file: string): boolean {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    // Gone already is fine. Any other read error says nothing about the owner, so never treat it as dead.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
  try {
    const { pid, time } = JSON.parse(text);
    return processAlive(pid) && Date.now() - time < MAX_LOCK_AGE_MS;
  } catch {
    return false; // Corrupt content: locks are published by rename, so this is never a half-written live lock.
  }
}

// Every window locks with its own uniquely named file and only ever deletes that one, so a window can never remove
// another owner's lock. Having created ours, we back off if any other live lock exists; two racing windows may
// both back off, but never both proceed. Locks of dead owners are cleaned up here.
function acquire(storageDir: string): string | undefined {
  fs.mkdirSync(storageDir, { recursive: true });
  const id = randomUUID();
  const own = path.join(storageDir, `hyperspace.lock.${id}`);
  const tmp = path.join(storageDir, `hyperspace.tmp.${id}`);
  // Renamed into place so no other window ever reads a half-written lock.
  fs.writeFileSync(tmp, JSON.stringify({ pid: process.pid, time: Date.now() }));
  fs.renameSync(tmp, own);

  try {
    let busy = false;
    for (const name of fs.readdirSync(storageDir)) {
      const other = path.join(storageDir, name);
      if (!LOCK_NAME.test(name) || other === own) continue;
      if (lockIsLive(other)) busy = true;
      else fs.rmSync(other, { force: true });
    }
    if (!busy) return own;
  } catch (e) {
    fs.rmSync(own, { force: true });
    throw e;
  }
  fs.rmSync(own, { force: true });
  return undefined;
}

// One jump or restore at a time across all windows. A command that arrives mid-transition is ignored.
async function withLock<T>(storageDir: string, fn: () => Promise<T>, busy: T): Promise<T> {
  const own = acquire(storageDir);
  if (!own) return busy;
  try {
    return await fn();
  } finally {
    fs.rmSync(own, { force: true });
  }
}

/** Jumps or restores. Returns the settings a workspace override kept from being hidden. */
export function toggle(storageDir: string): Promise<string[]> {
  return withLock(
    storageDir,
    async () => {
      if (isActive(storageDir)) {
        await restoreSnapshot(storageDir);
        return [];
      }
      return jump(storageDir);
    },
    [],
  );
}

/** Restores the saved settings. Resolves false, changing nothing, if another window is mid-transition. */
export function restore(storageDir: string): Promise<boolean> {
  return withLock(
    storageDir,
    async () => {
      await restoreSnapshot(storageDir);
      return true;
    },
    false,
  );
}

async function jump(storageDir: string): Promise<string[]> {
  const config = vscode.workspace.getConfiguration();
  const options = vscode.workspace.getConfiguration('towelwise.hyperspace');
  const chrome = CHROME.filter((c) => options.get(c.option, true));
  const fullScreen = options.get('fullScreen', false);
  const settings: Saved[] = chrome.map(({ key }) => {
    const value = config.inspect(key)?.globalValue;
    return { key, had: value !== undefined, value };
  });
  const snapshot: Snapshot = { settings, fullScreen };

  // Published first, and atomically, so a crash mid-jump stays recoverable and never leaves a half-written file.
  const file = stateFile(storageDir);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(snapshot));
  fs.renameSync(`${file}.tmp`, file);

  for (const { key, hidden } of chrome) {
    await config.update(key, hidden, GLOBAL);
  }
  for (const { option, command } of AREAS) {
    if (options.get(option, option === 'hideBottomPanel')) {
      await vscode.commands.executeCommand(command);
    }
  }
  if (fullScreen) await vscode.commands.executeCommand(TOGGLE_FULL_SCREEN);
  // A fresh read: `config` above is a snapshot taken before the updates.
  const after = vscode.workspace.getConfiguration();
  return chrome.filter(({ key, hidden }) => after.get(key) !== hidden).map(({ key }) => key);
}

function readSnapshot(file: string): Snapshot {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    const known = (s: Saved) =>
      typeof s?.key === 'string' && typeof s.had === 'boolean' && CHROME.some((c) => c.key === s.key);
    const snapshot = data as Snapshot;
    if (!Array.isArray(snapshot?.settings) || !snapshot.settings.every(known) || typeof snapshot.fullScreen !== 'boolean') {
      throw new Error('invalid snapshot');
    }
    return snapshot;
  } catch {
    fs.rmSync(file, { force: true });
    throw new Error('Hyperspace state was unreadable, so it was cleared. No settings were restored.');
  }
}

async function restoreSnapshot(storageDir: string): Promise<void> {
  const file = stateFile(storageDir);
  const { settings, fullScreen } = readSnapshot(file);
  const config = vscode.workspace.getConfiguration();
  for (const s of settings) {
    await config.update(s.key, s.had ? s.value : undefined, GLOBAL);
  }
  // Cleared before the toggle: a failure here leaves a window the user can fix with F11, never a stuck hyperspace.
  fs.rmSync(file);
  if (fullScreen) await vscode.commands.executeCommand(TOGGLE_FULL_SCREEN);
}
