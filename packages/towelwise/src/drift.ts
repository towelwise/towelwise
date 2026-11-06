// Noticing that the window no longer matches the saved layout, and offering to keep or restore it. VS Code has no event
// for resizing the editor grid, so the window is compared with the saved layout when it gains focus and every 30 seconds
// while it has focus. Never while hyperspace is on, while Choose Layout is open, or while a restore is running.
import * as vscode from 'vscode';
import { Layout, SavedGrid, SavedNode, leafCount, maxDifference, parseLayout, sameShape, toSaved } from './grid';
import { isActive } from './hyperspace';
import { saveLayoutSettings, isLayoutPageBusy, openLayoutPageFrom } from './layoutPanel';
import { MyLayout, isApplying, onApplied } from './myLayout';
import { readLayout } from './savedLayout';
import { LayoutState, PARTS, Sizes, orientationOf, parseLayoutState, toProportions } from './sizes';

/** How far a proportion may be from the saved one before it counts: 3% of its parent, or 3 points of the window. */
export const TOLERANCE = 0.03;

/** What the window looks like now; a part that could not be read is left out, and then is not compared. */
export interface Live {
  grid?: Layout;
  state?: LayoutState;
}

/** none: it matches; proportions: a size moved; shape: a column or row was added or removed. */
export type Drift = 'none' | 'proportions' | 'shape';

export function driftOf(saved: MyLayout, live: Live): Drift {
  if (saved.grid && live.grid) {
    if (!sameShape(saved.grid, live.grid)) return 'shape';
    if (maxDifference(saved.grid, live.grid) > TOLERANCE) return 'proportions';
  }
  if (saved.sizes && live.state) {
    const now = toProportions(live.state);
    for (const part of PARTS) {
      const wanted = saved.sizes[part];
      const here = now[part];
      // A hidden part has no size to compare, and a panel on another side is measured the other way.
      if (wanted === undefined || here === undefined) continue;
      if (part === 'panel' && saved.sizes.panelOrientation !== orientationOf(live.state.panelPosition)) continue;
      if (Math.abs(wanted - here) > TOLERANCE) return 'proportions';
    }
  }
  return 'none';
}

// The saved cells, with the live proportions: the shapes are the same, so the nodes line up one for one.
function retarget(saved: SavedNode[], live: SavedNode[]): SavedNode[] {
  return saved.map((node, i) => ({ ...node, size: live[i].size, ...(node.groups && live[i].groups ? { groups: retarget(node.groups, live[i].groups!) } : {}) }));
}

/**
 * The saved layout with the proportions and sizes the window has now. Each cell keeps what it holds and each agent keeps
 * its place; only the parts the saved layout had are updated. A grid of another shape is left as saved (the person edits that).
 */
export function captureLive(saved: MyLayout, live: Live): MyLayout {
  let grid: SavedGrid | undefined = saved.grid;
  if (saved.grid && live.grid && sameShape(saved.grid, live.grid)) {
    grid = { orientation: saved.grid.orientation, groups: retarget(saved.grid.groups, toSaved(live.grid).groups) };
  }
  let sizes: Sizes | undefined = saved.sizes;
  if (saved.sizes && live.state) {
    const now = toProportions(live.state);
    sizes = { ...saved.sizes };
    for (const part of PARTS) {
      if (saved.sizes[part] === undefined || now[part] === undefined) continue;
      if (part === 'panel' && saved.sizes.panelOrientation !== orientationOf(live.state.panelPosition)) continue;
      sizes[part] = now[part];
    }
  }
  return { ...saved, grid, sizes };
}

/** A window's own proportions as a layout, to tell later whether it has moved since. */
const snapshot = (live: Live): MyLayout => ({ grid: live.grid && toSaved(live.grid), sizes: live.state && toProportions(live.state) });

/**
 * Whether the quiet baseline measured everything that is comparable with the saved layout now. A part it could not read then
 * (the grid with a floating window open, a hidden side bar) is left out of its comparison, so it cannot vouch for that part
 * once it can be read: the person has not yet said Not now to how that part looks.
 */
function measuredAll(quiet: MyLayout, saved: MyLayout, live: Live): boolean {
  if (saved.grid && live.grid && !quiet.grid) return false;
  if (saved.sizes && live.state) {
    const now = toProportions(live.state);
    for (const part of PARTS) {
      if (saved.sizes[part] === undefined || now[part] === undefined) continue;
      if (part === 'panel' && saved.sizes.panelOrientation !== orientationOf(live.state.panelPosition)) continue;
      if (quiet.sizes?.[part] === undefined) return false;
      if (part === 'panel' && quiet.sizes.panelOrientation !== saved.sizes.panelOrientation) return false;
    }
  }
  return true;
}

/** What the watch needs from the window and the person, so tests can stand in for both. */
export interface DriftHost {
  /** The saved layout, or undefined when none is saved. */
  saved(): MyLayout | undefined;
  live(): Promise<Live>;
  /** Hyperspace is on, Choose Layout is open, or a restore is running. */
  blocked(): boolean;
  /** One message that does not block, with buttons; undefined when it is closed without a choice. */
  ask(message: string, buttons: string[]): PromiseLike<string | undefined>;
  /** Writes what `change` makes of the layout as saved at the moment of writing, under the cross-window lock; nothing if it returns undefined. */
  save(change: (saved: MyLayout) => MyLayout | undefined): Promise<void>;
  restore(): PromiseLike<unknown>;
  /** Opens Choose Layout, starting from the window's grid. */
  edit(live: Live): PromiseLike<unknown>;
  tell(message: string): void;
  log(line: string): void;
}

const SAVE = 'Save this layout';
const EDIT = 'Edit layout…';
const RESTORE = 'Restore saved layout';
const NOT_NOW = 'Not now';

export class DriftWatch {
  // The window as it was when the person said Not now (or after an apply): quiet until it moves from there.
  private quiet: MyLayout | undefined;
  private checking = false;

  constructor(private readonly host: DriftHost) {}

  /** After an apply: whatever VS Code made of the proportions is the baseline, not drift. */
  async settle(): Promise<void> {
    try {
      this.quiet = snapshot(await this.host.live());
    } catch (e) {
      this.host.log(`layout: could not read the window after applying it (${e instanceof Error ? e.message : String(e)})`);
    }
  }

  async check(): Promise<void> {
    // One look at a time, from reading the window to the answer: a focus event and the timer can arrive together.
    if (this.checking || this.host.blocked()) return;
    this.checking = true;
    try {
      await this.look();
    } finally {
      this.checking = false;
    }
  }

  private async look(): Promise<void> {
    const saved = this.host.saved();
    if (!saved) return;
    let live: Live;
    try {
      live = await this.host.live();
    } catch (e) {
      this.host.log(`layout: could not read the window for drift (${e instanceof Error ? e.message : String(e)})`);
      return;
    }
    // Something may have started while the window was being read.
    if (this.host.blocked()) return;
    const drift = driftOf(saved, live);
    if (drift === 'none') {
      this.quiet = undefined;
      return;
    }
    if (this.quiet && measuredAll(this.quiet, saved, live) && driftOf(this.quiet, live) === 'none') return;
    try {
      const choice = await this.host.ask('Your layout has changed since you saved it.', [drift === 'shape' ? EDIT : SAVE, RESTORE, NOT_NOW]);
      if (choice === RESTORE) {
        await this.host.restore();
        return;
      }
      // The message can stay open for a long time: what it was about may have moved, or been saved from another window.
      // Whatever the answer changes is decided on the window and the settings as they are now.
      const now = await this.current();
      if (choice === SAVE) {
        if (now) await this.save(now.live);
      } else {
        if (choice === EDIT && now) await this.host.edit(now.live);
        this.quiet = snapshot(now?.live ?? live);
      }
    } catch (e) {
      this.host.tell(`Towelwise: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** The saved layout and the window now, or nothing if there is no layout or something has started that keeps this out. */
  private async current(): Promise<{ saved: MyLayout; live: Live } | undefined> {
    const saved = this.host.saved();
    if (!saved || this.host.blocked()) return undefined;
    const live = await this.host.live();
    return this.host.blocked() ? undefined : { saved, live };
  }

  // Decided on the layout as saved when it is written: another window may have saved since this one looked.
  private async save(live: Live): Promise<void> {
    await this.host.save((saved) => {
      const drift = driftOf(saved, live);
      if (drift === 'none') return undefined; // it went back to the saved layout while the message was open
      if (drift === 'shape') {
        this.host.tell('Towelwise: your columns changed while that message was open, so nothing was saved. You will be asked again.');
        return undefined;
      }
      return captureLive(saved, live);
    });
  }
}

/** The window's focus, as the watch needs it. */
export interface FocusSource {
  readonly focused: boolean;
  onDidChange(listener: (focused: boolean) => void): { dispose(): void };
}

/** Runs `every` ms; returns how to stop it. A parameter only so tests need no real time. */
export interface Timers {
  every(fn: () => void, ms: number): () => void;
}

const REAL_TIMERS: Timers = {
  every: (fn, ms) => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
};

/** Calls `check` when the window gains focus and every 30 seconds while it has it. */
export function runWhileFocused(win: FocusSource, check: () => void, timers: Timers = REAL_TIMERS): { dispose(): void } {
  let stop: (() => void) | undefined;
  const begin = () => {
    stop?.();
    check();
    stop = timers.every(check, 30000);
  };
  const end = () => {
    stop?.();
    stop = undefined;
  };
  if (win.focused) begin();
  const listener = win.onDidChange((focused) => (focused ? begin() : end()));
  return {
    dispose: () => {
      end();
      listener.dispose();
    },
  };
}

/** The reads that make up the window's state, so tests can stand in for VS Code. */
export interface LiveReads {
  /** vscode.getEditorLayout: the grid of the window that is active, which may be a floating one. */
  layout(): PromiseLike<unknown>;
  /** The core bridge's grid of the main window, whichever window is active. Missing in stock VS Code. */
  mainLayout(): PromiseLike<unknown>;
  /** The core bridge's sizes: always the main window's. */
  state(): PromiseLike<unknown>;
  /** Every editor group in every window. */
  allGroups(): number;
}

/**
 * The main window's grid and sizes. With the core bridge both are the main window's, whichever window is active. Without it
 * (stock VS Code) the grid command answers for the active window, so the grid is kept only when it holds every editor
 * group there is (then no other window has any, and it cannot be another's), and the sizes are left out.
 */
export async function readLive(reads: LiveReads): Promise<Live> {
  const state = await Promise.resolve(reads.state()).then(parseLayoutState, () => undefined);
  let grid: Layout | undefined;
  try {
    grid = parseLayout(await reads.mainLayout());
  } catch {
    // No bridge. Every window has at least one editor group, so a grid that holds every group there is belongs to the only
    // window with any. Counted after the read: a window that opened while it ran may be the one that answered.
    try {
      grid = parseLayout(await reads.layout());
      if (grid && leafCount(grid) !== reads.allGroups()) grid = undefined;
    } catch {
      // Not readable: nothing to compare.
    }
  }
  return { grid, state };
}

const liveReads: LiveReads = {
  layout: () => Promise.resolve(vscode.commands.executeCommand('vscode.getEditorLayout')),
  mainLayout: () => Promise.resolve(vscode.commands.executeCommand('_towelwise.layout.mainLayout')),
  state: () => Promise.resolve(vscode.commands.executeCommand('_towelwise.layout.state')),
  allGroups: () => vscode.window.tabGroups.all.length,
};

export function liveDriftHost(storageDir: string, context: vscode.ExtensionContext, log: (line: string) => void): DriftHost {
  return {
    saved: () => readLayout(() => undefined),
    live: () => readLive(liveReads),
    blocked: () => isActive(storageDir) || isLayoutPageBusy() || isApplying(),
    ask: (message, buttons) => vscode.window.showInformationMessage(message, ...buttons),
    save: (change) =>
      saveLayoutSettings(() => {
        const saved = readLayout(() => undefined);
        const layout = saved && change(saved);
        return layout && { agents: layout.agents ?? {}, grid: layout.grid ?? {}, sizes: layout.sizes ?? {} };
      }),
    restore: () => vscode.commands.executeCommand('towelwise.layout.restore'),
    edit: (live) => {
      const saved = readLayout(log);
      openLayoutPageFrom(context, log, { agents: saved?.agents, grid: live.grid && toSaved(live.grid), sizes: saved?.sizes });
      return Promise.resolve();
    },
    tell: (message) => void vscode.window.showInformationMessage(message),
    log,
  };
}

/**
 * Starts watching this window. Call it after the layout was applied at startup: the window as it is then is the baseline,
 * and the watch is quiet again after every apply.
 */
export async function keepWatching(storageDir: string, context: vscode.ExtensionContext, log: (line: string) => void): Promise<void> {
  const watch = new DriftWatch(liveDriftHost(storageDir, context, log));
  onApplied(() => void watch.settle());
  await watch.settle();
  const win: FocusSource = {
    get focused() {
      return vscode.window.state.focused;
    },
    onDidChange: (listener) => vscode.window.onDidChangeWindowState((e) => listener(e.focused)),
  };
  context.subscriptions.push(runWhileFocused(win, () => void watch.check().catch((e) => log(`layout: drift check failed (${e instanceof Error ? e.message : String(e)})`))));
}
