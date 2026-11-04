import * as vscode from 'vscode';
import { AGENTS, AGENT_IDS, AgentId, AgentPlaces, Holds, Place, coreContainerId, parseAgents } from './agents';
import { holdsInOrder, parseLayoutGrid } from './columns';
import { Layout, SavedGrid, toLayout } from './grid';
import { Bridge, applySizes, isActive } from './hyperspace';
import { withLock } from './lock';
import { PARTS, Sizes, parseLayoutState, parseSizes } from './sizes';

// The three places a view container can live. The bridge uses the same names as the layout parts.
export type Location = 'sidebar' | 'auxiliarybar' | 'panel';

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
  /** The groups in the grid's reading order: left to right, top to bottom within a column. */
  groups(): object[];
  tabs(group: object): object[];
  /** What a tab is, if it is an agent or a terminal; undefined for anything else. */
  kind(tab: object): Holds | undefined;
  focus(group: object): PromiseLike<unknown>;
  moveTab(tab: object, to: object): PromiseLike<unknown>;
  closeTab(tab: object): PromiseLike<unknown>;
  openTerminal(group: object): PromiseLike<unknown>;
  /** Closes a group, which must be empty. */
  closeGroup(group: object): PromiseLike<unknown>;
  /**
   * Runs the work with empty groups held open (VS Code's closeEmptyGroups off), then puts the setting back exactly as
   * it was. If it cannot be changed the work still runs, and groups close as VS Code decides.
   */
  keepEmptyGroups<T>(run: () => Promise<T>): Promise<T>;
  /** Starts listening for a tab of this kind to open, so it is called before the command that opens it. */
  waitForTab(holds: Holds, ms: number): Promise<object | undefined>;
}

// What applying a layout needs from the window it runs in, so tests can stand in for it.
export interface MyLayoutHost {
  run(command: string): PromiseLike<unknown>;
  bridge: Bridge & Mover;
  grid?: { apply(layout: Layout): PromiseLike<unknown> };
  editors?: Editors;
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
  refused?: 'hyperspace';
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// A tab that has not opened by then is not going to.
const TAB_WAIT_MS = 15000;

/** Where "left", "right" or "panel" is, given which side the primary side bar is on. A column is not a location. */
export function locationFor(place: Place, sideBarOnRight: boolean): Location | undefined {
  if (place === 'panel') return 'panel';
  if (place === 'column') return undefined;
  return (place === 'left') !== sideBarOnRight ? 'sidebar' : 'auxiliarybar';
}

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

const holdsLabel = (holds: Holds) => (holds === 'terminal' ? 'Terminal' : AGENTS[holds].label);

// The first tab of this kind in the grid, and its group.
function findTab(editors: Editors, holds: Holds): { tab: object; group: object } | undefined {
  for (const group of editors.groups()) {
    const tab = editors.tabs(group).find((t) => editors.kind(t) === holds);
    if (tab) return { tab, group };
  }
  return undefined;
}

// Puts what a cell should hold in the group `target`, which is held by reference: opening an agent can add a group
// of its own and shift every number, and the group it leaves closes once empty.
async function fillCell(host: MyLayoutHost, editors: Editors, holds: Holds, target: object): Promise<string | undefined> {
  if (holds === 'terminal') {
    if (editors.tabs(target).some((t) => editors.kind(t) === 'terminal')) return undefined;
    await editors.openTerminal(target);
    return undefined;
  }
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
  try {
    await host.grid.apply(toLayout(grid));
    host.log('layout: editor grid shape and proportions applied');
  } catch (e) {
    return [`the editor grid could not be set (${errorText(e)})`];
  }
  const wanted = holdsInOrder(grid);
  const cells = editors.groups();
  if (cells.length !== wanted.length) {
    return [`the editor grid has ${cells.length} groups after it was set, not ${wanted.length}, so nothing was placed in its columns`];
  }
  const problems: string[] = [];
  // A group closes when its last tab leaves it, which would shift the grid, so empty groups are held open while tabs
  // move. The groups an agent opens for itself are then left empty and closed here, and only those: a cell of the
  // grid stays, empty or not.
  const placeAll = async () => {
    for (const [i, holds] of wanted.entries()) {
      if (!holds) continue;
      try {
        const problem = await fillCell(host, editors, holds, cells[i]);
        if (problem) problems.push(problem);
        else host.log(`layout: ${holdsLabel(holds)} is in cell ${i + 1}`);
      } catch (e) {
        problems.push(`${holdsLabel(holds)}: could not be placed in its column (${errorText(e)})`);
      }
    }
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
  if (editors.groups().length !== wanted.length) {
    problems.push('a column closed while tabs were moved, so the grid changed shape; run Restore Layout again');
  }
  return problems;
}

/** Closes every editor tab of an agent: the button on the "also open as a tab" report. */
export async function closeAgentTabs(editors: Editors, id: AgentId): Promise<void> {
  const tabs = editors.groups().flatMap((g) => editors.tabs(g).filter((t) => editors.kind(t) === id));
  for (const tab of tabs) await editors.closeTab(tab);
}

/**
 * Puts each chosen agent's side view where the layout says and opens it, builds the editor grid and fills its
 * columns, then sets the side bar and panel sizes last. Best effort: a step that fails is reported and the rest
 * still run. Nothing is closed.
 */
export async function applyLayout(host: MyLayoutHost, layout: MyLayout): Promise<Outcome> {
  const outcome: Outcome = { placed: [], problems: [], openAsTab: [] };
  if (host.hyperspaceActive()) return { ...outcome, refused: 'hyperspace' };
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
    if (host.editors && findTab(host.editors, id)) outcome.openAsTab.push(id);
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

/** What the three layout settings hold now; each part that is not saved, or does not fit, is left out and logged. */
export function readSaved(log: (line: string) => void): MyLayout {
  const config = vscode.workspace.getConfiguration('towelwise.layout');
  const agents = parseAgents(config.get<unknown>('agents'), log);
  return {
    agents,
    grid: parseLayoutGrid(config.get<unknown>('grid'), agents, log),
    sizes: parseSizes(config.get<unknown>('sizes'), log),
  };
}

/** Whether the person has saved a layout with Choose Layout: agents, a grid or sizes. Otherwise the earlier container list applies. */
export const layoutInUse = (saved: MyLayout): boolean => Boolean(saved.agents || saved.grid || (saved.sizes && Object.keys(saved.sizes).length > 0));

/** The saved layout, or undefined when none is saved (then the earlier container list applies). */
export function readLayout(log: (line: string) => void): MyLayout | undefined {
  const saved = readSaved(log);
  return layoutInUse(saved) ? saved : undefined;
}

export function liveHost(storageDir: string, log: (line: string) => void, editors?: Editors): MyLayoutHost {
  return {
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
