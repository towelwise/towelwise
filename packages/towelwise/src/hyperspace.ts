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
// The editor area is deliberately absent: VS Code only offers a blind toggle for it.
const AREAS = [
  { option: 'hidePrimarySideBar', command: 'workbench.action.closeSidebar' },
  { option: 'hideSecondarySideBar', command: 'workbench.action.closeAuxiliaryBar' },
  { option: 'hideBottomPanel', command: 'workbench.action.closePanel' },
];

const GLOBAL = vscode.ConfigurationTarget.Global;
// shortcut: a lock older than this is assumed to belong to a crashed window; raise it if a transition can run longer.
const STALE_LOCK_MS = 30_000;

export const stateFile = (storageDir: string) => path.join(storageDir, 'hyperspace.json');
const lockFile = (storageDir: string) => path.join(storageDir, 'hyperspace.lock');

export const isActive = (storageDir: string) => fs.existsSync(stateFile(storageDir));

function acquire(storageDir: string): boolean {
  const lock = lockFile(storageDir);
  fs.mkdirSync(storageDir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(lock, '', { flag: 'wx' });
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs < STALE_LOCK_MS) return false;
        fs.rmSync(lock, { force: true });
      } catch {
        // Released between the two calls; try to take it again.
      }
    }
  }
  return false;
}

// One jump or restore at a time across all windows. A command that arrives mid-transition is ignored.
async function withLock<T>(storageDir: string, fn: () => Promise<T>, busy: T): Promise<T> {
  if (!acquire(storageDir)) return busy;
  try {
    return await fn();
  } finally {
    fs.rmSync(lockFile(storageDir), { force: true });
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

export function restore(storageDir: string): Promise<void> {
  return withLock(storageDir, () => restoreSnapshot(storageDir), undefined);
}

async function jump(storageDir: string): Promise<string[]> {
  const config = vscode.workspace.getConfiguration();
  const options = vscode.workspace.getConfiguration('towelwise.hyperspace');
  const chrome = CHROME.filter((c) => options.get(c.option, true));
  const snapshot: Saved[] = chrome.map(({ key }) => {
    const value = config.inspect(key)?.globalValue;
    return { key, had: value !== undefined, value };
  });

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
  // A fresh read: `config` above is a snapshot taken before the updates.
  const after = vscode.workspace.getConfiguration();
  return chrome.filter(({ key, hidden }) => after.get(key) !== hidden).map(({ key }) => key);
}

function readSnapshot(file: string): Saved[] {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    const known = (s: Saved) =>
      typeof s?.key === 'string' && typeof s.had === 'boolean' && CHROME.some((c) => c.key === s.key);
    if (!Array.isArray(data) || !data.every(known)) throw new Error('invalid snapshot');
    return data;
  } catch {
    fs.rmSync(file, { force: true });
    throw new Error('Hyperspace state was unreadable, so it was cleared. No settings were restored.');
  }
}

async function restoreSnapshot(storageDir: string): Promise<void> {
  const file = stateFile(storageDir);
  const saved = readSnapshot(file);
  const config = vscode.workspace.getConfiguration();
  for (const s of saved) {
    await config.update(s.key, s.had ? s.value : undefined, GLOBAL);
  }
  fs.rmSync(file);
}
