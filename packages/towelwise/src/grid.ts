// The editor area's grid of groups: columns and rows with proportions. Pure logic only: reading and applying the
// live grid goes through VS Code's own vscode.getEditorLayout and vscode.setEditorLayout.
import { HOLDS, Holds } from './agents';
import { CellTerminal, isEmptyTerminal, parseCellTerminal } from './cellTerminal';

/** A group or a split of groups, as vscode.getEditorLayout returns it and vscode.setEditorLayout accepts it. */
export interface LayoutNode {
  size: number;
  groups?: LayoutNode[];
}

/** orientation 0 lays the top level out as columns, 1 as rows; each level inside alternates. */
export interface Layout {
  orientation: 0 | 1;
  groups: LayoutNode[];
}

/**
 * The saved form: sizes are proportions of the parent. A leaf may carry a label for the picker only, and (in a saved
 * layout) what it holds, and for a terminal, which terminal.
 */
export interface SavedNode {
  size: number;
  label?: string;
  holds?: Holds;
  terminal?: CellTerminal;
  groups?: SavedNode[];
}

export interface SavedGrid {
  orientation: 0 | 1;
  groups: SavedNode[];
}

const isSize = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

function parseNodes<T extends LayoutNode | SavedNode>(raw: unknown, keepLabels: boolean): T[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const nodes: T[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    if (typeof item !== 'object' || item === null || !isSize(item.size)) return undefined;
    const node: SavedNode = { size: item.size };
    if (item.groups !== undefined) {
      const children = parseNodes<SavedNode>(item.groups, keepLabels);
      if (!children) return undefined;
      node.groups = children;
    } else if (keepLabels) {
      if (typeof item.label === 'string' && item.label !== '') node.label = item.label;
      if (item.holds !== undefined) {
        if (!HOLDS.includes(item.holds as Holds)) return undefined;
        node.holds = item.holds as Holds;
      }
      if (item.terminal !== undefined) {
        const terminal = node.holds === 'terminal' ? parseCellTerminal(item.terminal) : undefined;
        if (!terminal) return undefined;
        if (!isEmptyTerminal(terminal)) node.terminal = terminal;
      }
    }
    nodes.push(node as T);
  }
  return nodes;
}

function parse<T extends LayoutNode | SavedNode>(raw: unknown, keepLabels: boolean): { orientation: 0 | 1; groups: T[] } | undefined {
  const r = raw as { orientation?: unknown; groups?: unknown } | null | undefined;
  if (!r || typeof r !== 'object' || (r.orientation !== 0 && r.orientation !== 1)) return undefined;
  const groups = parseNodes<T>(r.groups, keepLabels);
  return groups ? { orientation: r.orientation, groups } : undefined;
}

/** What vscode.getEditorLayout returned, checked. */
export const parseLayout = (raw: unknown): Layout | undefined => parse<LayoutNode>(raw, false);

/** The towelwise.hyperspace.editorGrid setting: a value that does not fit is ignored as a whole and logged. */
export function parseSavedGrid(raw: unknown, log: (line: string) => void): SavedGrid | undefined {
  if (raw === undefined || (typeof raw === 'object' && raw !== null && !Array.isArray(raw) && Object.keys(raw).length === 0)) {
    return undefined;
  }
  const grid = parse<SavedNode>(raw, true);
  if (!grid) log('ignored editorGrid: not a grid of groups with proportions above 0');
  return grid;
}

const total = (nodes: { size: number }[]) => nodes.reduce((sum, n) => sum + n.size, 0);

function scale(nodes: LayoutNode[]): SavedNode[] {
  const sum = total(nodes);
  return nodes.map((n) => ({ size: n.size / sum, ...(n.groups ? { groups: scale(n.groups) } : {}) }));
}

/** The live grid as proportions of each parent, so it carries across window sizes. */
export const toSaved = (live: Layout): SavedGrid => ({ orientation: live.orientation, groups: scale(live.groups) });

/** The saved grid in the form vscode.setEditorLayout takes (proportions are fine: it only uses them relatively). */
export function toLayout(saved: SavedGrid): Layout {
  const strip = (nodes: SavedNode[]): LayoutNode[] =>
    nodes.map((n) => ({ size: n.size, ...(n.groups ? { groups: strip(n.groups) } : {}) }));
  return { orientation: saved.orientation, groups: strip(saved.groups) };
}

const shape = (nodes: { groups?: unknown[] }[]): string =>
  `[${nodes.map((n) => (n.groups ? shape(n.groups as { groups?: unknown[] }[]) : 'g')).join(',')}]`;

/** Same top-level orientation and the same nested columns and rows; sizes and contents play no part. */
export const sameShape = (a: Layout | SavedGrid, b: Layout | SavedGrid): boolean =>
  a.orientation === b.orientation && shape(a.groups) === shape(b.groups);

export function leafCount(grid: Layout | SavedGrid): number {
  const count = (nodes: { groups?: unknown[] }[]): number =>
    nodes.reduce((n, node) => n + (node.groups ? count(node.groups as { groups?: unknown[] }[]) : 1), 0);
  return count(grid.groups);
}

/**
 * The largest difference between two grids of the same shape, as proportions of each parent (0 to 1). Used to see
 * whether VS Code gave the proportions that were asked for.
 */
export function maxDifference(a: Layout | SavedGrid, b: Layout | SavedGrid): number {
  const diff = (x: { size: number; groups?: unknown[] }[], y: { size: number; groups?: unknown[] }[]): number => {
    const sx = total(x);
    const sy = total(y);
    let worst = 0;
    for (let i = 0; i < x.length; i++) {
      worst = Math.max(worst, Math.abs(x[i].size / sx - y[i].size / sy));
      if (x[i].groups && y[i].groups) {
        worst = Math.max(worst, diff(x[i].groups as typeof x, y[i].groups as typeof y));
      }
    }
    return worst;
  };
  return diff(a.groups, b.groups);
}

/** Labels the cells in order (the grid's reading order), or leaves it unlabelled if the counts differ. */
export function attachLabels(grid: SavedGrid, labels: string[]): SavedGrid {
  if (labels.length !== leafCount(grid)) return grid;
  let next = 0;
  const walk = (nodes: SavedNode[]): SavedNode[] =>
    nodes.map((n) => {
      if (n.groups) return { size: n.size, groups: walk(n.groups) };
      const label = labels[next++];
      return label ? { size: n.size, label } : { size: n.size };
    });
  return { orientation: grid.orientation, groups: walk(grid.groups) };
}
