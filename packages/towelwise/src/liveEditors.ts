import * as vscode from 'vscode';
import { Holds, holdsOfTab } from './agents';
import { Editors } from './myLayout';

const inputInfo = (tab: vscode.Tab) => {
  const input = tab.input;
  if (input instanceof vscode.TabInputWebview) return { type: 'webview' as const, viewType: input.viewType };
  if (input instanceof vscode.TabInputCustom) return { type: 'custom' as const, viewType: input.viewType };
  if (input instanceof vscode.TabInputTerminal) return { type: 'terminal' as const };
  return { type: 'other' as const };
};

const kindOf = (tab: vscode.Tab): Holds | undefined => holdsOfTab(inputInfo(tab));

// The grid's reading order: VS Code numbers the groups' view columns that way.
const real = () => [...vscode.window.tabGroups.all].sort((a, b) => a.viewColumn - b.viewColumn);

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

// A tab that opened alone in a new group has put a group into the list at that position.
function noteOpened(tab: vscode.Tab): void {
  const all = real();
  if (registry.length === 0 || all.length !== registry.length + 1) return;
  const at = all.findIndex((g) => g.tabs.includes(tab));
  if (at >= 0 && all[at].tabs.length === 1) registry.splice(at, 0, {});
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
  try {
    await config.update(SETTING, false, vscode.ConfigurationTarget.Global);
    return true;
  } catch {
    return false;
  }
}

async function putBack(): Promise<void> {
  // The user's own value again, or no value at all if they had none.
  await vscode.workspace.getConfiguration('workbench.editor').update(SETTING, original, vscode.ConfigurationTarget.Global);
}

/** The editor area of the window this extension runs in, through the tab-groups API and VS Code's own editor commands. */
export const liveEditors: Editors = {
  groups: () => handles(),
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
  closeTab: (tab) => vscode.window.tabGroups.close(tab as vscode.Tab),
  async closeGroup(group) {
    const at = registry.indexOf(group);
    await vscode.window.tabGroups.close(groupOf(group));
    registry.splice(at, 1);
  },
  label: (tab) => (tab as vscode.Tab).label,
  openTerminal: async (group, open) => {
    const terminal = vscode.window.createTerminal({
      name: open?.name,
      shellPath: open?.shellPath,
      shellArgs: open?.shellArgs,
      cwd: open?.cwd,
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
        noteOpened(tab);
        resolve(tab);
      });
    }),
};
