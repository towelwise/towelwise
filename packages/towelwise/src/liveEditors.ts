import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Holds, holdsOfTab } from './agents';
import { withLock } from './lock';
import { readRecoveryText } from './recoveryFile';
import { Editors } from './myLayout';

const inputInfo = (tab: vscode.Tab) => {
  const input = tab.input;
  if (input instanceof vscode.TabInputWebview) return { type: 'webview' as const, viewType: input.viewType };
  if (input instanceof vscode.TabInputCustom) return { type: 'custom' as const, viewType: input.viewType };
  if (input instanceof vscode.TabInputTerminal) return { type: 'terminal' as const };
  return { type: 'other' as const };
};

const kindOf = (tab: vscode.Tab): Holds | undefined => holdsOfTab(inputInfo(tab));

/** Calls onChange whenever a tab of one of these kinds opens or closes. A tab that only changes (its label, say) does not count. */
export function watchTabs(kinds: readonly Holds[], onChange: () => void): vscode.Disposable {
  return vscode.window.tabGroups.onDidChangeTabs((e) => {
    if ([...e.opened, ...e.closed].some((tab) => kinds.includes(kindOf(tab) as Holds))) onChange();
  });
}

// The main window's group count, while only the main window's groups are wanted (see useMainWindow); undefined means
// every group counts. It is the main window's own count, not the other windows': a floating window that closes during a
// restore then changes nothing here, where a cached count of the others would drop a main group from the list.
let mainCount: number | undefined;

// The core bridge's count of the main window's groups; a test stands in for it, as stock VS Code has no bridge.
let mainGroupCount: () => Thenable<unknown> = () => vscode.commands.executeCommand('_towelwise.layout.mainGroupCount');
// The bridge's answer if it is a count that makes sense, otherwise undefined (no bridge, or something unusable).
async function readMainCount(): Promise<number | undefined> {
  try {
    const count = await mainGroupCount();
    return typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : undefined;
  } catch {
    return undefined;
  }
}
export function setMainGroupCount(read: () => Thenable<unknown>): () => void {
  const before = mainGroupCount;
  mainGroupCount = read;
  return () => {
    mainGroupCount = before;
  };
}

// The grid's reading order: VS Code numbers the groups' view columns that way, the main window's first and then
// those of other editor windows, so the first mainCount groups are the main window's.
const everyGroup = () => [...vscode.window.tabGroups.all].sort((a, b) => a.viewColumn - b.viewColumn);
const real = () => {
  const all = everyGroup();
  return mainCount === undefined || mainCount > all.length ? all : all.slice(0, mainCount);
};

// The groups handed out are our own tokens, one per group in reading order, because VS Code 1.90 gives new group
// objects after every change (newer versions keep them), so a group cannot be held by the object the API returns. A
// token's position in the list is its group. The list is kept right across the one change a restore causes, a group an
// agent opens for itself (see noteOpened); any other change in the number of groups starts the list again.
let registry: object[] = [];
const handles = (): object[] => {
  const count = real().length;
  if (registry.length !== count) registry = Array.from({ length: count }, () => ({}));
  return [...registry];
};
const groupOf = (handle: object): vscode.TabGroup => {
  const at = registry.indexOf(handle);
  const group = at < 0 ? undefined : real()[at];
  if (!group) throw new Error('that group is gone');
  return group;
};

// A tab that opened alone in a new group has put a group into the list at that position. With only the main window's
// groups wanted, whether a group appeared is read from the main window's own count, which a floating window opening or
// closing at the same moment cannot change; the total of all windows cannot tell the two apart. Otherwise every group
// counts, and a total one larger than the list is the sign.
async function noteOpened(tab: vscode.Tab): Promise<void> {
  if (registry.length === 0) return;
  const all = everyGroup();
  const at = all.findIndex((g) => g.tabs.includes(tab));
  if (at < 0 || all[at].tabs.length !== 1) return;
  if (mainCount === undefined) {
    if (all.length === registry.length + 1) registry.splice(at, 0, {});
    return;
  }
  const fresh = await readMainCount();
  if (fresh === mainCount + 1) {
    registry.splice(at, 0, {});
    mainCount = fresh;
  }
}

const run = (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args);

// Focus the first group, then step to the next one, so any group can be reached, not only the first eight that have
// a command of their own.
async function focusGroup(handle: object): Promise<void> {
  groupOf(handle);
  const at = registry.indexOf(handle);
  await run('workbench.action.focusFirstEditorGroup');
  for (let i = 0; i < at; i++) await run('workbench.action.focusNextGroup');
}

// The setting is held off for the whole time anyone is placing, and put back once by the last one out. Every change to
// it goes through one chain, so a restore that starts while another is running joins its hold instead of ending it.
// (Restores in different windows are kept apart by the lock the command takes; this is the part within one window.)
const SETTING = 'closeEmptyGroups';
let users = 0;
let held = false;
let original: boolean | undefined;
let chain: Promise<unknown> = Promise.resolve();
const serially = <T>(task: () => Promise<T>): Promise<T> => {
  const result = chain.then(task, task);
  chain = result.catch(() => undefined);
  return result;
};

async function holdOff(): Promise<boolean> {
  const config = vscode.workspace.getConfiguration('workbench.editor');
  const inspected = config.inspect<boolean>(SETTING);
  // Only the user's own setting is changed from here; a project's value would win over it anyway.
  const overridden = inspected?.workspaceValue !== undefined || inspected?.workspaceFolderValue !== undefined;
  if (overridden || !config.get<boolean>(SETTING, true)) return false;
  original = inspected?.globalValue;
  // Written before the change, so a window that dies mid-restore still leaves what is needed to undo it. If it cannot
  // be written, the setting is not touched: a crash would then leave it off for good.
  if (!writeRecord(original)) return false;
  try {
    await config.update(SETTING, false, vscode.ConfigurationTarget.Global);
    return true;
  } catch {
    removeRecord();
    return false;
  }
}

async function putBack(): Promise<void> {
  // The user's own value again, or no value at all if they had none.
  await vscode.workspace.getConfiguration('workbench.editor').update(SETTING, original, vscode.ConfigurationTarget.Global);
  removeRecord();
}

// The user's value, kept on disk while the setting is held off. Left out (undefined) where no folder was given.
let recordFile: string | undefined;
const recordPath = (storageDir: string) => path.join(storageDir, 'closeEmptyGroups.held.json');

/** Says where the held setting's record is kept; call once at activation. */
export function keepHoldRecordIn(storageDir: string | undefined): void {
  recordFile = storageDir && recordPath(storageDir);
}

/** False if the record could not be written. With no folder given there is nothing to write, and that is fine. */
function writeRecord(value: boolean | undefined): boolean {
  if (!recordFile) return true;
  try {
    fs.mkdirSync(path.dirname(recordFile), { recursive: true });
    fs.writeFileSync(recordFile, JSON.stringify({ had: value !== undefined, value }));
    return true;
  } catch {
    return false;
  }
}

/** A record this code wrote: a flag, and the user's value when the flag says there was one. */
const isRecord = (r: unknown): r is { had: boolean; value?: boolean } =>
  typeof r === 'object' && r !== null && typeof (r as { had?: unknown }).had === 'boolean' &&
  ((r as { had: boolean }).had ? typeof (r as { value?: unknown }).value === 'boolean' : true);

function removeRecord(): void {
  if (recordFile) fs.rmSync(recordFile, { force: true });
}

/**
 * If a window died while it held the setting off, puts the user's value back. Runs under the cross-window lock, so a
 * hold that is still live in another window is left alone. A setting the user changed since is not overwritten.
 */
export async function recoverHeldSetting(storageDir: string, log: (line: string) => void = () => undefined): Promise<boolean> {
  const file = recordPath(storageDir);
  if (!fs.existsSync(file)) return false;
  return withLock(
    storageDir,
    async () => {
      // A read that fails throws and keeps the record; only content that does not fit is dropped below.
      const text = readRecoveryText(file);
      let saved: unknown;
      try {
        saved = text === undefined ? undefined : JSON.parse(text);
      } catch {
        saved = undefined;
      }
      if (!isRecord(saved)) {
        fs.rmSync(file, { force: true }); // Unreadable or not ours: nothing to restore from, and the setting stays as it is.
        return false;
      }
      const config = vscode.workspace.getConfiguration('workbench.editor');
      if (config.inspect<boolean>(SETTING)?.globalValue === false) {
        const value = saved.had ? saved.value : undefined;
        await config.update(SETTING, value, vscode.ConfigurationTarget.Global);
        log(`put closeEmptyGroups back to ${value ?? 'unset'} after a restore was cut short`);
      }
      fs.rmSync(file, { force: true });
      return true;
    },
    false,
  );
}

/** The editor area of the window this extension runs in, through the tab-groups API and VS Code's own editor commands. */
export const liveEditors: Editors = {
  groups: () => handles(),
  async useMainWindow() {
    // No bridge: every group counts, as before.
    const main = await readMainCount();
    mainCount = main !== undefined && main <= vscode.window.tabGroups.all.length ? main : undefined;
  },
  useAllWindows: () => {
    mainCount = undefined;
  },
  tabs: (group) => [...groupOf(group).tabs],
  kind: (tab) => kindOf(tab as vscode.Tab),
  focus: (group) => focusGroup(group),
  // Makes the tab the active one in its group, then moves the active editor to the target's position. The target's
  // position is read now, because opening and closing groups shifts it.
  async moveTab(tab, to) {
    const all = real();
    const fromAt = all.findIndex((g) => g.tabs.includes(tab as vscode.Tab));
    const toAt = registry.indexOf(to);
    if (fromAt < 0 || toAt < 0 || toAt >= all.length) throw new Error('the tab or its target group is gone');
    await focusGroup(registry[fromAt] ?? handles()[fromAt]);
    await run('workbench.action.openEditorAtIndex', all[fromAt].tabs.indexOf(tab as vscode.Tab));
    await run('moveActiveEditor', { to: 'position', by: 'group', value: toAt + 1 });
  },
  closeTabs: (tabs) => vscode.window.tabGroups.close(tabs as vscode.Tab[]),
  async closeGroup(group) {
    const at = registry.indexOf(group);
    await vscode.window.tabGroups.close(groupOf(group));
    registry.splice(at, 1);
    if (mainCount !== undefined) mainCount--;
  },
  label: (tab) => (tab as vscode.Tab).label,
  openTerminal: async (group, open) => {
    const terminal = vscode.window.createTerminal({
      name: open?.name,
      shellPath: open?.shellPath,
      shellArgs: open?.shellArgs,
      cwd: open?.cwd,
      // Not restored on reload: VS Code brings a revived terminal back under its process's title ("bash"), not this name,
      // so a restore could not recognise it and would open a second one. The layout opens it again instead.
      isTransient: true,
      location: { viewColumn: groupOf(group).viewColumn, preserveFocus: true },
    });
    // VS Code holds the text until the shell is ready for it.
    if (open?.command) terminal.sendText(open.command);
  },
  async keepEmptyGroups(work) {
    await serially(async () => {
      if (users++ === 0) held = await holdOff();
    });
    try {
      return await work();
    } finally {
      await serially(async () => {
        if (--users === 0 && held) {
          held = false;
          await putBack();
        }
      });
    }
  },
  settled: (ms) =>
    new Promise<void>((resolve) => {
      // An empty label is a revived terminal whose name has not been restored yet.
      const waiting = () => real().some((g) => g.tabs.some((t) => kindOf(t) === 'terminal' && t.label === ''));
      if (!waiting()) return resolve();
      const done = () => {
        clearTimeout(timer);
        watch.dispose();
        resolve();
      };
      const timer = setTimeout(done, ms);
      const watch = vscode.window.tabGroups.onDidChangeTabs(() => {
        if (!waiting()) done();
      });
    }),
  waitForTab: (holds, ms) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        watch.dispose();
        resolve(undefined);
      }, ms);
      const watch = vscode.window.tabGroups.onDidChangeTabs((e) => {
        const tab = e.opened.find((t) => kindOf(t) === holds);
        if (!tab) return;
        clearTimeout(timer);
        watch.dispose();
        // The list is made right before anyone is told the tab is there.
        noteOpened(tab).then(
          () => resolve(tab),
          () => resolve(tab),
        );
      });
    }),
};
