import * as vscode from 'vscode';
import { AGENTS, AGENT_IDS, AgentId, AgentPlaces, Place, coreContainerId, parseAgents } from './agents';
import { Bridge, applySizes, isActive } from './hyperspace';
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

// What applying a layout needs from the window it runs in, so tests can stand in for it.
export interface MyLayoutHost {
  run(command: string): PromiseLike<unknown>;
  bridge: Bridge & Mover;
  // workbench.sideBar.location: which side the primary side bar is on, so "left" always means the left of the screen.
  sideBarOnRight: boolean;
  hyperspaceActive(): boolean;
  log(line: string): void;
  tell(message: string): void;
}

export interface MyLayout {
  agents?: AgentPlaces;
  sizes?: Sizes;
}

export interface Outcome {
  placed: AgentId[];
  problems: string[];
  refused?: 'hyperspace';
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Where "left", "right" or "panel" is, given which side the primary side bar is on. The editor area is not a location. */
export function locationFor(place: Place, sideBarOnRight: boolean): Location | undefined {
  if (place === 'panel') return 'panel';
  if (place === 'editor') return undefined;
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
  if (!location) return `${label}: placing it in the editor area comes with the editor grid, so it was left alone`;
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

/**
 * Puts each chosen agent's side view where the layout says, opens it, then sets the side bar and panel sizes last.
 * Best effort: a step that fails is reported and the rest still run. Nothing is closed.
 */
export async function applyLayout(host: MyLayoutHost, layout: MyLayout): Promise<Outcome> {
  const outcome: Outcome = { placed: [], problems: [] };
  if (host.hyperspaceActive()) return { ...outcome, refused: 'hyperspace' };
  for (const id of AGENT_IDS) {
    const place = layout.agents?.[id];
    if (!place) continue;
    const problem = await placeAgent(host, id, place);
    if (problem) {
      host.log(`layout: ${problem}`);
      outcome.problems.push(problem);
    } else {
      outcome.placed.push(id);
    }
  }
  if (layout.sizes) {
    // Reported with the other problems at the end, so the sizes host does not tell the person on its own.
    const sized = await applySizes({ windowId: '', run: host.run, bridge: host.bridge, log: host.log }, layout.sizes, new Set(PARTS));
    for (const problem of sized) {
      host.log(`layout: ${problem}`);
      outcome.problems.push(problem);
    }
  }
  return outcome;
}

/** The saved layout from settings, or undefined when no agents are set (then the earlier container list applies). */
export function readLayout(log: (line: string) => void): MyLayout | undefined {
  const config = vscode.workspace.getConfiguration('towelwise.layout');
  const agents = parseAgents(config.get<unknown>('agents'), log);
  if (!agents) return undefined;
  return { agents, sizes: parseSizes(config.get<unknown>('sizes'), log) };
}

export function liveHost(storageDir: string, log: (line: string) => void): MyLayoutHost {
  return {
    run: (command) => vscode.commands.executeCommand(command),
    bridge: {
      state: async () => parseLayoutState(await vscode.commands.executeCommand('_towelwise.layout.state')),
      setSize: (part, pixels) => vscode.commands.executeCommand('_towelwise.layout.setSize', part, pixels),
      locate: (id) => vscode.commands.executeCommand('_towelwise.layout.locate', id),
      moveContainer: (id, location) => vscode.commands.executeCommand('_towelwise.layout.moveContainer', id, location),
    },
    sideBarOnRight: vscode.workspace.getConfiguration('workbench').get('sideBar.location') === 'right',
    hyperspaceActive: () => isActive(storageDir),
    log,
    tell: (message) => void vscode.window.showInformationMessage(message),
  };
}
