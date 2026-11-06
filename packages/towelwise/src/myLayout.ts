import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { AGENTS, AGENT_IDS, AgentId, AgentPlaces, Holds, Place, coreContainerId } from './agents';
import { CellTerminal, TerminalOpen, isEmptyTerminal, planTerminal, terminalName } from './cellTerminal';
import { cellsInOrder } from './columns';
import { Layout, SavedGrid, toLayout } from './grid';
import { Bridge, applySizes, focusMain, isActive } from './hyperspace';
import { withLock } from './lock';
import { Location, locationFor } from './savedLayout';
import { Machine, detectMachine } from './shells';
import { PARTS, Sizes, parseLayoutState } from './sizes';

/** What the core bridge adds for moving views, beside reading and setting sizes. */
export interface Mover {
  /** Where the container lives now, or undefined if the window has no such container. */
  locate(containerId: string): PromiseLike<unknown>;
  /** Moves the container; false if it could not be moved. */
  moveContainer(containerId: string, location: Location): PromiseLike<unknown>;
}

/**
 * The editor area's groups and tabs, as far as placing things in columns needs. Groups and tabs are opaque handles the
 * host hands out; a group handle stays valid while its group exists, even when other groups open and close around it.
 */
export interface Editors {
  /**
   * The groups in the grid's reading order: left to right, top to bottom within a column. Between useMainWindow and
   * useAllWindows, only the main window's; otherwise every window's.
   */
  groups(): object[];
  /**
   * Reads how many groups are in other editor windows (the Choose Layout page's own, a floating file's), so groups()
   * leaves them out. Read again after anything that may open or close another window.
   */
  useMainWindow(): PromiseLike<unknown>;
  useAllWindows(): void;
  tabs(group: object): object[];
  /** What a tab is, if it is an agent or a terminal; undefined for anything else. */
  kind(tab: object): Holds | undefined;
  /** The text on a tab; a terminal's is its name. */
  label(tab: object): string;
  focus(group: object): PromiseLike<unknown>;
  moveTab(tab: object, to: object): PromiseLike<unknown>;
  /** Closes these tabs in one call, so the set is fixed before anything is awaited. */
  closeTabs(tabs: object[]): PromiseLike<unknown>;
  /** Opens a terminal in the group: as described, or the default one; a startup command is sent once it is open. */
  openTerminal(group: object, open?: TerminalOpen): PromiseLike<unknown>;
  /** Closes a group, which must be empty. */
  closeGroup(group: object): PromiseLike<unknown>;
  /**
   * Runs the work with empty groups held open (VS Code's closeEmptyGroups off), then puts the setting back exactly as
   * it was. If it cannot be changed the work still runs, and groups close as VS Code decides.
   */
  keepEmptyGroups<T>(run: () => Promise<T>): Promise<T>;
  /**
   * Waits, for at most `ms`, until no terminal tab is still waiting for its name: VS Code brings a terminal back after a
   * reload with an empty name, and restores it a moment later. Returns at once when none is waiting.
   */
  settled(ms: number): PromiseLike<unknown>;
  /** Starts listening for a tab of this kind to open, so it is called before the command that opens it. */
  waitForTab(holds: Holds, ms: number): Promise<object | undefined>;
}

// What applying a layout needs from the window it runs in, so tests can stand in for it.
export interface MyLayoutHost {
  run(command: string): PromiseLike<unknown>;
  bridge: Bridge & Mover;
  grid?: { apply(layout: Layout): PromiseLike<unknown> };
  editors?: Editors;
  /**
   * Brings the main window to the front, so the commands that act on the active editor window act on it: true once it
   * is active, false if it could not be. Left out where the core bridge is not available.
   */
  focusMain?(): PromiseLike<boolean | undefined>;
  /** How a cell's terminal opens on this machine, with a problem line for each piece that falls back. */
  planTerminal(terminal: CellTerminal): PromiseLike<{ open: TerminalOpen; problems: string[] }>;
  // workbench.sideBar.location: which side the primary side bar is on, so "left" always means the left of the screen.
  sideBarOnRight: boolean;
  hyperspaceActive(): boolean;
  log(line: string): void;
  tell(message: string): void;
}

export interface MyLayout {
  agents?: AgentPlaces;
  grid?: SavedGrid;
  sizes?: Sizes;
}

export interface Outcome {
  placed: AgentId[];
  problems: string[];
  // Agents placed in a side bar or the panel that also have an editor tab open. Nothing is closed for them.
  openAsTab: AgentId[];
  // Which apply this was, so the report's "Close it" can tell a later apply has overtaken it. Set with openAsTab.
  run?: number;
  refused?: 'hyperspace';
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// A tab that has not opened by then is not going to.
const TAB_WAIT_MS = 15000;
// A revived terminal that has not got its name back by then is not going to.
const TERMINAL_NAME_WAIT_MS = 5000;

// The first of an agent's containers that the window has, and where it lives.
async function findContainer(host: MyLayoutHost, id: AgentId): Promise<{ id: string; at: unknown } | undefined> {
  for (const declared of AGENTS[id].containers) {
    const container = coreContainerId(declared);
    const at = await host.bridge.locate(container);
    if (at !== undefined) return { id: container, at };
  }
  return undefined;
}

async function placeAgent(host: MyLayoutHost, id: AgentId, place: Place): Promise<string | undefined> {
  const { label, openSidebar } = AGENTS[id];
  const location = locationFor(place, host.sideBarOnRight);
  if (!location) return undefined;
  let problem: string | undefined;
  try {
    const found = await findContainer(host, id);
    if (!found) return `${label}: not installed or not available in this window`;
    if (found.at !== location) {
      const moved = await host.bridge.moveContainer(found.id, location);
      if (moved === false) problem = `${label}: could not be moved to the ${place === 'panel' ? 'bottom panel' : `${place} side bar`}`;
      else host.log(`layout: moved ${found.id} to ${location}`);
    }
  } catch (e) {
    problem = `${label}: could not be moved (${errorText(e)})`;
  }
  // Opened even if the move failed, so the person still gets the agent, only not where they asked.
  try {
    await host.run(openSidebar);
    host.log(`layout: ran ${openSidebar}`);
  } catch (e) {
    return `${label}: could not be opened (${errorText(e)})`;
  }
  return problem;
}

const holdsLabel = (holds: Holds, terminal?: CellTerminal) =>
  holds !== 'terminal' ? AGENTS[holds].label : terminal ? terminalName(terminal) : 'Terminal';

// The first tab of this kind in the grid, and its group.
function findTab(editors: Editors, holds: Holds): { tab: object; group: object } | undefined {
  for (const group of editors.groups()) {
    const tab = editors.tabs(group).find((t) => editors.kind(t) === holds);
    if (tab) return { tab, group };
  }
  return undefined;
}

// A terminal cell already holds its terminal: one with its name, or for a cell saved without a choice of terminal,
// any terminal. Then restoring again opens nothing and reruns no command. A terminal with its name in another group is
// moved in, unless that group is a cell that wants such a terminal itself (`claimed`): after a reload VS Code brings
// terminals back in the groups it remembers, which can be off by one from the grid, and opening another would double them.
async function fillTerminal(host: MyLayoutHost, editors: Editors, terminal: CellTerminal | undefined, target: object, claimed: object[]): Promise<string[]> {
  const terminals = editors.tabs(target).filter((t) => editors.kind(t) === 'terminal');
  if (!terminal) {
    if (terminals.length === 0) await editors.openTerminal(target);
    return [];
  }
  const name = terminalName(terminal);
  const named = (t: object) => editors.kind(t) === 'terminal' && editors.label(t) === name;
  // The terminal already in the cell (true), or one to move in from another group.
  const find = (): true | object | undefined =>
    editors.tabs(target).some(named) ||
    editors
      .groups()
      .filter((g) => g !== target && !claimed.includes(g))
      .flatMap((g) => editors.tabs(g))
      .find(named);
  let have = find();
  if (!have) {
    // A revived terminal can be there before its name is, so look again once the names have had their moment.
    await editors.settled(TERMINAL_NAME_WAIT_MS);
    have = find();
  }
  if (have === true) return [];
  if (have) {
    await editors.moveTab(have, target);
    return [];
  }
  const { open, problems } = await host.planTerminal(terminal);
  await editors.openTerminal(target, open);
  return problems;
}

// Puts what a cell should hold in the group `target`, which is held by reference: opening an agent can add a group
// of its own and shift every number, and the group it leaves closes once empty. Returns the problems; a terminal that
// fell back to another shell or folder is still in its cell.
async function fillCell(host: MyLayoutHost, editors: Editors, holds: Holds, terminal: CellTerminal | undefined, target: object, claimed: object[]): Promise<string[]> {
  if (holds === 'terminal') return fillTerminal(host, editors, terminal, target, claimed);
  const problem = await fillAgent(host, editors, holds, target);
  return problem ? [problem] : [];
}

async function fillAgent(host: MyLayoutHost, editors: Editors, holds: Exclude<Holds, 'terminal'>, target: object): Promise<string | undefined> {
  const label = AGENTS[holds].label;
  const existing = findTab(editors, holds);
  if (existing) {
    if (existing.group !== target) await editors.moveTab(existing.tab, target);
    return undefined;
  }
  const { command, inFocusedGroup } = AGENTS[holds].editor;
  if (inFocusedGroup) await editors.focus(target);
  const opened = editors.waitForTab(holds, TAB_WAIT_MS);
  await host.run(command);
  if (!(await opened)) return `${label}: did not open as a tab`;
  if (!editors.groups().includes(target)) return `${label}: its column closed before it could be placed`;
  const landed = findTab(editors, holds);
  if (landed && landed.group !== target) await editors.moveTab(landed.tab, target);
  return undefined;
}

/** Sets the grid's shape and proportions, then puts each cell's agent or terminal in it. Nothing is closed. */
async function placeColumns(host: MyLayoutHost, grid: SavedGrid): Promise<string[]> {
  const { editors } = host;
  if (!host.grid || !editors) return ['the editor grid could not be set: this window cannot read or set it'];
  // Setting the grid, focusing groups and moving tabs act on whichever editor window is active.
  if (host.focusMain && (await host.focusMain()) === false) {
    return ['the main window could not be brought to the front, so the editor grid was left alone; click the main window and run Restore Layout again'];
  }
  try {
    return await placeInMainWindow(host, editors, host.grid, grid);
  } finally {
    editors.useAllWindows();
  }
}

async function placeInMainWindow(host: MyLayoutHost, editors: Editors, gridHost: NonNullable<MyLayoutHost['grid']>, grid: SavedGrid): Promise<string[]> {
  try {
    await gridHost.apply(toLayout(grid));
    host.log('layout: editor grid shape and proportions applied');
  } catch (e) {
    return [`the editor grid could not be set (${errorText(e)})`];
  }
  const wanted = cellsInOrder(grid);
  await editors.useMainWindow();
  const cells = editors.groups();
  if (cells.length !== wanted.length) {
    return [`the editor grid has ${cells.length} groups after it was set, not ${wanted.length}, so nothing was placed in its columns`];
  }
  const problems: string[] = [];
  // A group closes when its last tab leaves it, which would shift the grid, so empty groups are held open while tabs
  // move. The groups an agent opens for itself are then left empty and closed here, and only those: a cell of the
  // grid stays, empty or not.
  const placeAll = async () => {
    for (const [i, { holds, terminal }] of wanted.entries()) {
      if (!holds) continue;
      try {
        await editors.useMainWindow();
        // Cells whose terminal this one must not take: those that want the same terminal, and those that want any (a cell
        // saved without a choice is filled by whatever terminal it holds).
        const sameTerminal = terminal && terminalName(terminal);
        const claimed = cells.filter(
          (_, j) =>
            j !== i &&
            wanted[j].holds === 'terminal' &&
            (isEmptyTerminal(wanted[j].terminal) || terminalName(wanted[j].terminal!) === sameTerminal),
        );
        const found = await fillCell(host, editors, holds, terminal, cells[i], claimed);
        problems.push(...found);
        if (found.length === 0) host.log(`layout: ${holdsLabel(holds, terminal)} is in cell ${i + 1}`);
      } catch (e) {
        problems.push(`${holdsLabel(holds, terminal)}: could not be placed in its column (${errorText(e)})`);
      }
    }
    await editors.useMainWindow();
    for (const group of editors.groups()) {
      if (cells.includes(group) || editors.tabs(group).length > 0) continue;
      try {
        await editors.closeGroup(group);
      } catch (e) {
        problems.push(`an empty group could not be closed (${errorText(e)})`);
      }
    }
  };
  try {
    await editors.keepEmptyGroups(placeAll);
  } catch (e) {
    problems.push(`placing in the columns failed (${errorText(e)})`);
  }
  // Still possible if the setting could not be held off (a project overrides it): reported, and a second run converges.
  await editors.useMainWindow();
  if (editors.groups().length !== wanted.length) {
    problems.push('a column closed while tabs were moved, so the grid changed shape; run Restore Layout again');
  }
  return problems;
}

/** Every tab of this kind in the grid. */
const tabsOf = (editors: Editors, holds: Holds): object[] => editors.groups().flatMap((g) => editors.tabs(g).filter((t) => editors.kind(t) === holds));

/**
 * Closes every editor tab of these agents: the button on the "also open as a tab" report, once reportOutcome has checked
 * the report is still current. The tabs are all found before anything is awaited, and closed in one call: a conversation
 * opened while the closing is in flight must not be found by a later look.
 */
export async function closeAgentTabs(editors: Editors, ids: readonly AgentId[]): Promise<void> {
  const tabs = ids.flatMap((id) => tabsOf(editors, id));
  if (tabs.length > 0) await editors.closeTabs(tabs);
}

/**
 * Puts each chosen agent's side view where the layout says and opens it, builds the editor grid and fills its
 * columns, then sets the side bar and panel sizes last. Best effort: a step that fails is reported and the rest
 * still run. Nothing is closed.
 */
export async function applyLayout(host: MyLayoutHost, layout: MyLayout): Promise<Outcome> {
  applying++;
  try {
    return await applyNow(host, layout);
  } finally {
    applying--;
    for (const listener of whenApplied) listener();
  }
}

let latestRun = 0;

// Applies running in this window, and who is told when one ends: the drift watch keeps quiet during one and starts again after.
let applying = 0;
const whenApplied: (() => void)[] = [];
export const isApplying = (): boolean => applying > 0;
export function onApplied(listener: () => void): void {
  whenApplied.push(listener);
}

async function applyNow(host: MyLayoutHost, layout: MyLayout): Promise<Outcome> {
  const outcome: Outcome = { placed: [], problems: [], openAsTab: [] };
  if (host.hyperspaceActive()) return { ...outcome, refused: 'hyperspace' };
  // Counted once the apply really starts: it puts an end to the offers of every earlier apply.
  const run = ++latestRun;
  const report = (problem: string) => {
    host.log(`layout: ${problem}`);
    outcome.problems.push(problem);
  };
  for (const id of AGENT_IDS) {
    const place = layout.agents?.[id];
    if (!place) continue;
    if (place === 'column') {
      if (!layout.grid) report(`${AGENTS[id].label}: placed in a column, but no valid editor grid is saved`);
      continue;
    }
    const problem = await placeAgent(host, id, place);
    if (problem) report(problem);
    else outcome.placed.push(id);
    // Its side view is where it was asked to be; a tab of the same agent in the editor is a second copy.
    if (host.editors && findTab(host.editors, id)) {
      outcome.openAsTab.push(id);
      outcome.run = run;
    }
  }
  if (layout.grid) {
    for (const problem of await placeColumns(host, layout.grid)) report(problem);
    for (const id of AGENT_IDS) {
      if (layout.agents?.[id] === 'column' && !outcome.problems.some((p) => p.startsWith(AGENTS[id].label))) outcome.placed.push(id);
    }
  }
  if (layout.sizes) {
    // Reported with the other problems at the end, so the sizes host does not tell the person on its own.
    const sized = await applySizes({ windowId: '', run: host.run, bridge: host.bridge, log: host.log }, layout.sizes, new Set(PARTS));
    for (const problem of sized) report(problem);
  }
  return outcome;
}

/**
 * One restore at a time across all windows, with the lock hyperspace uses: a second one, here or in another window, is
 * told it is busy and does nothing. Placing columns holds a user setting off, and an overlapping run would end that
 * hold under the first.
 */
export function applyLayoutLocked(storageDir: string, host: MyLayoutHost, layout: MyLayout): Promise<Outcome | 'busy'> {
  return withLock<Outcome | 'busy'>(storageDir, () => applyLayout(host, layout), 'busy');
}

/** How a report reaches the person: a message, and a message with a button that says whether it was pressed. */
export interface ReportUi {
  tell(message: string): void;
  offer(message: string, button: string): PromiseLike<boolean>;
}

/** Calls onChange whenever a tab of one of these agents opens or closes; dispose ends it. */
export type WatchTabs = (agents: readonly AgentId[], onChange: () => void) => { dispose(): void };
const noWatch: WatchTabs = () => ({ dispose: () => undefined });

/**
 * Tells the person what an apply could not do: what was not placed, an agent also open as an editor tab (with a button
 * that closes it; nothing closes otherwise), or that hyperspace is on. The returned promise ends when the offer does, so
 * callers that must not wait for the person do not await it.
 *
 * The offer can stay on screen for a long time. A tab does not keep an identity VS Code gives extensions (nor does it
 * across versions), and a conversation opened since may hold an unsent draft, so the button closes nothing once a tab
 * of that agent has opened or closed, or another layout has been applied; it says so instead.
 */
export async function reportOutcome(outcome: Outcome, ui: ReportUi, closeTabs: (ids: readonly AgentId[]) => PromiseLike<unknown>, watch: WatchTabs = noWatch): Promise<void> {
  if (outcome.refused) {
    ui.tell('Towelwise: leave hyperspace first, then restore your layout.');
    return;
  }
  if (outcome.problems.length > 0) ui.tell(`Towelwise: your layout is applied, except: ${outcome.problems.join('; ')}.`);
  if (outcome.openAsTab.length === 0) return;
  const names = outcome.openAsTab.map((id) => AGENTS[id].label).join(' and ');
  let changed = false;
  const watching = watch(outcome.openAsTab, () => (changed = true));
  let pressed: boolean;
  try {
    pressed = await ui.offer(`Towelwise: ${names} also open${outcome.openAsTab.length > 1 ? '' : 's'} as an editor tab.`, 'Close it');
  } finally {
    watching.dispose();
  }
  if (!pressed) return;
  if (changed || (outcome.run !== undefined && outcome.run !== latestRun)) {
    ui.tell('Towelwise: that report is out of date (a tab opened or closed, or another layout was applied), so nothing was closed.');
    return;
  }
  // One call, made in the same step as the check above: nothing is awaited in between.
  await closeTabs(outcome.openAsTab);
}

/**
 * Applies the saved layout when a window opens, unless the person turned that off or hyperspace is on, and hands the
 * outcome to `report`, which gives the same report as Restore Layout. Returns whether a layout was applied.
 */
export async function applyLayoutOnStartup(
  storageDir: string,
  host: MyLayoutHost,
  layout: MyLayout,
  report: (outcome: Outcome) => void = () => undefined,
): Promise<boolean> {
  if (!vscode.workspace.getConfiguration('towelwise.layout').get('applyOnStartup', true)) return false;
  if (host.hyperspaceActive()) {
    host.log('layout: not applied on startup, because hyperspace is on');
    return false;
  }
  const outcome = await applyLayoutLocked(storageDir, host, layout);
  if (outcome === 'busy') {
    host.log('layout: not applied on startup, because another window is restoring or jumping');
    return false;
  }
  if (outcome.refused) {
    host.log('layout: not applied on startup, because hyperspace is on');
    return false;
  }
  report(outcome);
  return true;
}

// Found once per window: WSL is asked for its distributions, which takes a moment.
let machine: Promise<Machine> | undefined;
const isFolder = (p: string) => fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() === true;

export function liveHost(storageDir: string, log: (line: string) => void, editors?: Editors): MyLayoutHost {
  // Read once per restore: trust granted while it runs must not start its commands; only the next restore may (decision 0006).
  const trusted = vscode.workspace.isTrusted;
  return {
    focusMain,
    planTerminal: async (terminal) => {
      machine ??= detectMachine();
      const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
      return planTerminal(terminal, await machine, folders, isFolder, trusted);
    },
    run: (command) => vscode.commands.executeCommand(command),
    bridge: {
      state: async () => parseLayoutState(await vscode.commands.executeCommand('_towelwise.layout.state')),
      setSize: (part, pixels) => vscode.commands.executeCommand('_towelwise.layout.setSize', part, pixels),
      locate: (id) => vscode.commands.executeCommand('_towelwise.layout.locate', id),
      moveContainer: (id, location) => vscode.commands.executeCommand('_towelwise.layout.moveContainer', id, location),
    },
    grid: { apply: (layout) => vscode.commands.executeCommand('vscode.setEditorLayout', layout) },
    editors,
    sideBarOnRight: vscode.workspace.getConfiguration('workbench').get('sideBar.location') === 'right',
    hyperspaceActive: () => isActive(storageDir),
    log,
    tell: (message) => void vscode.window.showInformationMessage(message),
  };
}
