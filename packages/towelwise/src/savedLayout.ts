import * as vscode from 'vscode';
import { AGENT_IDS, AgentId, Place, parseAgents } from './agents';
import { parseLayoutGrid } from './columns';
import type { MyLayout } from './myLayout';
import { parseSizes } from './sizes';

// The three places a view container can live. The bridge uses the same names as the layout parts.
export type Location = 'sidebar' | 'auxiliarybar' | 'panel';

/** Where "left", "right" or "panel" is, given which side the primary side bar is on. A column is not a location. */
export function locationFor(place: Place, sideBarOnRight: boolean): Location | undefined {
  if (place === 'panel') return 'panel';
  if (place === 'column') return undefined;
  return (place === 'left') !== sideBarOnRight ? 'sidebar' : 'auxiliarybar';
}

/** The agents the layout puts in each part. A part with no agents is not in use; with no layout, none is. */
export function agentsByPart(saved: MyLayout | undefined, sideBarOnRight: boolean): Record<Location, AgentId[]> {
  const parts: Record<Location, AgentId[]> = { sidebar: [], auxiliarybar: [], panel: [] };
  for (const id of AGENT_IDS) {
    const place = saved?.agents?.[id];
    const at = place && locationFor(place, sideBarOnRight);
    if (at) parts[at].push(id);
  }
  return parts;
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
