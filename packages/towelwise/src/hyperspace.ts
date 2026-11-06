import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Layout, leafCount, maxDifference, parseLayout, parseSavedGrid, sameShape, toLayout } from './grid';
import { withLock } from './lock';
import { readRecoveryText } from './recoveryFile';
import { agentsByPart, readLayout } from './savedLayout';
import {
  LayoutState,
  PartName,
  Recorded,
  parseLayoutState,
  parseRecorded,
  parseSizes,
  planRestore,
  planSizes,
  record,
} from './sizes';

interface Saved {
  key: string;
  had: boolean;
  value?: unknown;
}

// fullScreen records that the jump toggled full screen in the window windowId, so only that window toggles it back.
// sizes are the pixel sizes found before the jump, for the same window; absent if none were read.
// grid is the editor area's layout found before the jump, for the same window.
interface Snapshot {
  settings: Saved[];
  fullScreen: boolean;
  windowId?: string;
  sizes?: Recorded;
  grid?: Layout;
}

// Reads and applies the editor area's grid of groups in the window it belongs to.
interface Grid {
  read(): PromiseLike<unknown>;
  apply(layout: Layout): PromiseLike<unknown>;
}

// Reads and sets part sizes in the window it belongs to. Absent without the core bridge.
export interface Bridge {
  state(): PromiseLike<LayoutState | undefined>;
  setSize(part: PartName, pixels: number): PromiseLike<unknown>;
}

// The window running a transition: its id (new on every start) and how it runs VS Code commands.
// A parameter only so tests can stand in for other windows and observe or fail commands.
export interface Host {
  windowId: string;
  run(command: string): PromiseLike<unknown>;
  bridge?: Bridge;
  grid?: Grid;
  /** Brings the main window to the front; false if it could not, undefined with no bridge (stock VS Code). */
  focusMain?(): PromiseLike<boolean | undefined>;
  log?(line: string): void;
  tell?(message: string): void;
}

/** Brings the main window forward, since the editor-grid commands act on the active one. undefined: no bridge (stock VS Code). */
export async function focusMain(): Promise<boolean | undefined> {
  try {
    return (await vscode.commands.executeCommand<unknown>('_towelwise.layout.focusMain')) === true;
  } catch {
    return undefined;
  }
}

let logLine: (line: string) => void = () => undefined;
/** Where sizes problems are logged; the extension passes its output channel. */
export const setLog = (log: (line: string) => void) => {
  logLine = log;
};

const DEFAULT_HOST: Host = {
  windowId: randomUUID(),
  run: (command) => vscode.commands.executeCommand(command),
  focusMain,
  bridge: {
    state: async () => parseLayoutState(await vscode.commands.executeCommand('_towelwise.layout.state')),
    setSize: (part, pixels) => vscode.commands.executeCommand('_towelwise.layout.setSize', part, pixels),
  },
  // The main window's grid, whichever window is active (sizes already are). Stock VS Code has no bridge: the active window's.
  grid: {
    read: async () => {
      try {
        return await vscode.commands.executeCommand('_towelwise.layout.mainLayout');
      } catch {
        return vscode.commands.executeCommand('vscode.getEditorLayout');
      }
    },
    apply: (layout) => vscode.commands.executeCommand('vscode.setEditorLayout', layout),
  },
  log: (line) => logLine(line),
  tell: (message) => void vscode.window.showInformationMessage(message),
};

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// VS Code only offers a toggle and cannot report the current state, so this is opt-in and assumes the window starts windowed.
const TOGGLE_FULL_SCREEN = 'workbench.action.toggleFullScreen';

// `option` is the towelwise.hyperspace.* setting that turns each item on or off.
export const CHROME = [
  { option: 'hideActivityBar', key: 'workbench.activityBar.location', hidden: 'hidden' },
  { option: 'hideStatusBar', key: 'workbench.statusBar.visible', hidden: false },
  { option: 'hideMenuBar', key: 'window.menuBarVisibility', hidden: 'hidden' },
  { option: 'hideCommandCenter', key: 'window.commandCenter', hidden: false },
  { option: 'hideLayoutControls', key: 'workbench.layoutControl.enabled', hidden: false },
];

// Close commands are no-ops on an area that is already closed, so they never open anything.
// The editor area is deliberately absent: VS Code only offers a blind toggle for it.
export const AREAS = [
  { option: 'hidePrimarySideBar', command: 'workbench.action.closeSidebar', part: 'sidebar' as PartName },
  { option: 'hideSecondarySideBar', command: 'workbench.action.closeAuxiliaryBar', part: 'auxiliarybar' as PartName },
  { option: 'hideBottomPanel', command: 'workbench.action.closePanel', part: 'panel' as PartName },
];

const GLOBAL = vscode.ConfigurationTarget.Global;
export const stateFile = (storageDir: string) => path.join(storageDir, 'hyperspace.json');

export const isActive = (storageDir: string) => fs.existsSync(stateFile(storageDir));

// Full screen, the areas and the grid act on the window in front, so the main window comes first; if it cannot, nothing changes.
async function mainToFront(host: Host): Promise<void> {
  if ((await host.focusMain?.()) === false) {
    throw new Error('the main window could not be brought to the front. Click it and try again');
  }
}

/** Jumps or restores. Returns the settings a workspace override kept from being hidden. */
export function toggle(storageDir: string, host = DEFAULT_HOST): Promise<string[]> {
  return withLock(
    storageDir,
    async () => {
      await mainToFront(host);
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
      await mainToFront(host);
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
  const saved = readLayout((line) => host.log?.(line));

  // Sizes are best effort: a failed read means this jump leaves sizes alone and records none. The sizes are
  // recorded even when none are saved, because hiding areas or full screen can make the grid change the rest.
  // With a saved layout, its sizes and grid are the only ones; hyperspace's own apply only when none is saved.
  if (saved) host.log?.('a layout is saved, so its sizes and editor grid apply and towelwise.hyperspace.sizes and editorGrid are ignored');
  const wanted = saved ? (saved.sizes ?? {}) : parseSizes(options.get<unknown>('sizes'), (line) => host.log?.(line));
  const sizing = await readState(host);
  if (sizing) snapshot.sizes = record(sizing);
  // The editor grid is recorded the same way, whether or not a grid is saved.
  const liveGrid = await readGrid(host);
  if (liveGrid) snapshot.grid = liveGrid;

  // Published first, so a crash mid-jump stays recoverable.
  publish(storageDir, snapshot);

  for (const { key, hidden } of chrome) {
    await config.update(key, hidden, GLOBAL);
  }
  // An area the saved layout puts an agent in is never closed, whatever its hide setting says; the setting is left as it is.
  const inUse = agentsByPart(saved, config.get('workbench.sideBar.location') === 'right');
  const hidden = AREAS.filter(({ option, part }) => options.get<boolean>(option) && inUse[part].length === 0);
  for (const { command } of hidden) {
    await host.run(command);
  }
  if (options.get<boolean>('fullScreen')) {
    await host.run(TOGGLE_FULL_SCREEN);
    // Recorded only once the toggle succeeded, so restore never toggles a window that did not enter full screen.
    publish(storageDir, { ...snapshot, fullScreen: true });
  }
  // Last, so proportions apply to the window as it now is (after full screen), and with fresh visibility.
  if (sizing && Object.keys(wanted).length > 0) {
    const kept = new Set(AREAS.filter((area) => !hidden.includes(area)).map(({ part }) => part));
    await applySizes(host, wanted, kept);
  }
  // After the side bars and panel, so the grid's proportions apply to the editor area's final size.
  const savedGrid = saved ? saved.grid : parseSavedGrid(options.get<unknown>('editorGrid'), (line) => host.log?.(line));
  if (savedGrid && leafCount(savedGrid) > 1) await applyGrid(host, savedGrid);
  // A fresh read: `config` above is a snapshot taken before the updates.
  const after = vscode.workspace.getConfiguration();
  return chrome.filter(({ key, hidden }) => after.get(key) !== hidden).map(({ key }) => key);
}

// A failure is logged and also added to problems, for a caller that reports what could not be applied.
async function readState(host: Host, problems: string[] = []): Promise<LayoutState | undefined> {
  try {
    const state = await host.bridge?.state();
    if (!state) {
      host.log?.('sizes: no layout bridge, so sizes are left alone');
      problems.push('sizes: the layout could not be read, so sizes were left alone');
    }
    return state;
  } catch (e) {
    host.log?.(`sizes: could not read the layout (${errorText(e)}), so sizes are left alone`);
    problems.push(`sizes: the layout could not be read (${errorText(e)}), so sizes were left alone`);
    return undefined;
  }
}

// Each size is tried on its own; a grid that adjusts a size is logged, a failure is logged, and neither stops anything.
async function setSizes(host: Host, set: { part: PartName; pixels: number }[], problems: string[] = []): Promise<void> {
  for (const { part, pixels } of set) {
    try {
      const actual = await host.bridge?.setSize(part, pixels);
      host.log?.(actual === pixels ? `sizes: ${part} set to ${pixels}px` : `sizes: ${part} asked for ${pixels}px, got ${String(actual)}px`);
    } catch (e) {
      host.log?.(`sizes: could not set ${part} (${errorText(e)})`);
      problems.push(`sizes: could not set the ${part} size (${errorText(e)})`);
    }
  }
}

/** Applies the sizes; best effort. Returns what could not be applied, for a caller that reports it (a jump ignores it). */
export async function applySizes(host: Host, wanted: ReturnType<typeof parseSizes>, kept: ReadonlySet<PartName>): Promise<string[]> {
  const problems: string[] = [];
  const state = await readState(host, problems);
  if (!state) return problems;
  const { set, skipped } = planSizes(wanted, state, kept);
  if (skipped.length > 0) {
    host.tell?.('Towelwise: the bottom panel is on a different side than when you saved its size, so its size was left alone.');
    problems.push('sizes: the bottom panel is on a different side than when its size was saved, so its size was left alone');
  }
  await setSizes(host, set, problems);
  return problems;
}

async function readGrid(host: Host): Promise<Layout | undefined> {
  try {
    const layout = parseLayout(await host.grid?.read());
    if (!layout) host.log?.('editor grid: could not read the layout, so it is left alone');
    return layout;
  } catch (e) {
    host.log?.(`editor grid: could not read the layout (${errorText(e)}), so it is left alone`);
    return undefined;
  }
}

// Pixel rounding alone stays well inside this.
const GRID_TOLERANCE = 0.01;

// Applies a layout if the live grid still has the same shape; a different shape is left alone.
async function setGrid(host: Host, layout: Layout, mismatch: () => void): Promise<void> {
  const live = await readGrid(host);
  if (!live) return;
  if (!sameShape(live, layout)) return mismatch();
  try {
    await host.grid?.apply(layout);
    // VS Code may adjust what it was asked for (minimum editor sizes), so read it back and log any difference.
    const after = await readGrid(host);
    const off = after && sameShape(after, layout) ? maxDifference(layout, after) : undefined;
    host.log?.(
      off !== undefined && off > GRID_TOLERANCE
        ? `editor grid: proportions applied, but adjusted by up to ${Math.round(off * 100)}% of a parent`
        : 'editor grid: proportions applied',
    );
  } catch (e) {
    host.log?.(`editor grid: could not apply the layout (${errorText(e)})`);
  }
}

async function applyGrid(host: Host, saved: ReturnType<typeof parseSavedGrid> & object): Promise<void> {
  await setGrid(host, toLayout(saved), () => {
    host.log?.('editor grid: different columns and rows than saved, so it is left alone');
    host.tell?.("Towelwise: the editor area's columns and rows are not the same as when you saved your layout, so their proportions were left alone.");
  });
}

async function restoreGrid(host: Host, recorded: Layout): Promise<void> {
  await setGrid(host, recorded, () => host.log?.('editor grid: the columns and rows changed while in hyperspace, so it is left alone'));
}

async function restoreSizes(host: Host, recorded: Recorded): Promise<void> {
  const state = await readState(host);
  if (!state) return;
  const { set, skipped } = planRestore(recorded, state);
  if (skipped.length > 0) {
    host.tell?.('Towelwise: the bottom panel moved while you were in hyperspace, so its size was left alone.');
  }
  await setSizes(host, set);
}

function readSnapshot(file: string): Snapshot {
  // Outside the try: a read that fails keeps the file, and only content that does not fit is cleared.
  const text = readRecoveryText(file) ?? '';
  try {
    const data: unknown = JSON.parse(text);
    const known = (s: Saved) =>
      typeof s?.key === 'string' && typeof s.had === 'boolean' && CHROME.some((c) => c.key === s.key);
    // A bare array is the previous version's format: settings only, no full screen.
    const snapshot = (Array.isArray(data) ? { settings: data, fullScreen: false } : data) as Snapshot;
    if (!Array.isArray(snapshot?.settings) || !snapshot.settings.every(known) || typeof snapshot.fullScreen !== 'boolean') {
      throw new Error('invalid snapshot');
    }
    // Size data is optional: if it does not fit, sizes are skipped and the settings still restore.
    if (snapshot.sizes !== undefined) snapshot.sizes = parseRecorded(snapshot.sizes);
    // The same for the editor grid: absent or unfit data skips it.
    if (snapshot.grid !== undefined) snapshot.grid = parseLayout(snapshot.grid);
    return snapshot;
  } catch {
    fs.rmSync(file, { force: true });
    throw new Error('Hyperspace state was unreadable, so it was cleared. No settings were restored.');
  }
}

async function restoreSnapshot(storageDir: string, host: Host): Promise<void> {
  const file = stateFile(storageDir);
  const { settings, fullScreen, windowId, sizes, grid } = readSnapshot(file);
  const config = vscode.workspace.getConfiguration();
  for (const s of settings) {
    await config.update(s.key, s.had ? s.value : undefined, GLOBAL);
  }
  // Cleared before the toggle: a failure here leaves a window the user can fix with F11, never a stuck hyperspace.
  fs.rmSync(file);
  const jumper = windowId === host.windowId;
  // Full screen belongs to one window and VS Code toggles whichever window is active, so only the jumper toggles it back.
  if (fullScreen && jumper) await host.run(TOGGLE_FULL_SCREEN);
  else if (fullScreen) {
    void vscode.window.showInformationMessage(
      'Towelwise: your settings are restored. The window that jumped is still full screen; press F11 there to leave it.',
    );
  }
  // Sizes last, once the window is its normal size again, and only in the window that jumped.
  if (sizes && jumper) await restoreSizes(host, sizes);
  if (grid && jumper) await restoreGrid(host, grid);
}
