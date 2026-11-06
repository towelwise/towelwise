// The editor grid as the person builds it: columns, each split into rows. Pure logic; nothing here touches VS Code.
// A column with one row is a plain cell; a column with several is a nested group, the shape VS Code's editor layout
// uses. Sizes are proportions of the parent (the columns of the window, the rows of a column) and always sum to 1.
import { AGENTS, AGENT_IDS, AgentPlaces, Holds } from './agents';
import { CellTerminal, isEmptyTerminal } from './cellTerminal';
import { SavedGrid, SavedNode, parseSavedGrid } from './grid';

export interface Row {
  size: number;
  holds?: Holds;
  // Only on a row that holds a terminal.
  terminal?: CellTerminal;
}

export interface Column {
  size: number;
  rows: Row[];
}

// No cell is made smaller than this by resizing: a sliver cannot show an agent.
export const MIN_CELL = 0.1;

const sum = (xs: { size: number }[]) => xs.reduce((total, x) => total + x.size, 0);

// Scales sizes so they sum to 1, keeping their proportions.
function normalised<T extends { size: number }>(items: T[]): T[] {
  const total = sum(items);
  return items.map((item) => ({ ...item, size: item.size / total }));
}

// Moves the edge between items[at] and items[at + 1], as dragging a splitter does: items[at] becomes the wanted size,
// clamped so both keep at least MIN_CELL, and its neighbour takes the rest of their shared room. Others are unchanged.
function dragged<T extends { size: number }>(items: T[], at: number, wanted: number): T[] {
  const next = items.map((item) => ({ ...item }));
  if (at < 0 || at >= items.length - 1) return next;
  const room = items[at].size + items[at + 1].size;
  if (room < 2 * MIN_CELL) return next;
  const size = Math.min(Math.max(wanted, MIN_CELL), room - MIN_CELL);
  next[at].size = size;
  next[at + 1].size = room - size;
  return next;
}

const copy = (cols: Column[]): Column[] =>
  cols.map((c) => ({ size: c.size, rows: c.rows.map((r) => ({ ...r, ...(r.terminal ? { terminal: { ...r.terminal } } : {}) })) }));

export const defaultColumns = (): Column[] => [
  { size: 0.5, rows: [{ size: 1 }] },
  { size: 0.5, rows: [{ size: 1 }] },
];

/** Another column fits while every column can stay at least MIN_CELL wide. */
export const canAddColumn = (cols: Column[]): boolean => cols.length < Math.floor(1 / MIN_CELL);

/** A row can be split while both halves stay at least MIN_CELL tall. */
export const canAddRow = (cols: Column[], column: number, row: number): boolean => (cols[column]?.rows[row]?.size ?? 0) / 2 >= MIN_CELL - 1e-9;

/**
 * A new empty column at the left or right edge, with its share of the window taken evenly from the others. If that
 * would squeeze a narrow column below MIN_CELL, all columns are made equal instead. Unchanged if there is no room.
 */
export function addColumn(cols: Column[], side: 'left' | 'right'): Column[] {
  if (!canAddColumn(cols)) return copy(cols);
  const share = 1 / (cols.length + 1);
  let kept = copy(cols).map((c) => ({ ...c, size: c.size * (1 - share) }));
  if (kept.some((c) => c.size < MIN_CELL - 1e-9)) kept = kept.map((c) => ({ ...c, size: share }));
  const added: Column = { size: share, rows: [{ size: 1 }] };
  return side === 'left' ? [added, ...kept] : [...kept, added];
}

/** Removes a column and spreads its room over the rest. The last column stays. */
export function removeColumn(cols: Column[], at: number): Column[] {
  if (cols.length <= 1 || at < 0 || at >= cols.length) return copy(cols);
  return normalised(copy(cols).filter((_, i) => i !== at));
}

/** A new empty row under a row, taking half of that row's room. Unchanged if the halves would be under MIN_CELL. */
export function addRow(cols: Column[], column: number, row: number): Column[] {
  const next = copy(cols);
  const rows = next[column]?.rows;
  if (!rows || !rows[row] || !canAddRow(cols, column, row)) return next;
  const half = rows[row].size / 2;
  rows[row].size = half;
  rows.splice(row + 1, 0, { size: half });
  return next;
}

/** Removes a row and spreads its room over the rest. A column's only row stays. */
export function removeRow(cols: Column[], column: number, row: number): Column[] {
  const next = copy(cols);
  const target = next[column];
  if (!target || target.rows.length <= 1 || !target.rows[row]) return next;
  target.rows = normalised(target.rows.filter((_, i) => i !== row));
  return next;
}

/** Drags the edge to the right of column `at` so the column is `wanted` wide (a proportion of the window). */
export const dragColumnEdge = (cols: Column[], at: number, wanted: number): Column[] => dragged(copy(cols), at, wanted);

/** Drags the edge under row `row` of a column so the row is `wanted` tall (a proportion of the column). */
export function dragRowEdge(cols: Column[], column: number, row: number, wanted: number): Column[] {
  const next = copy(cols);
  if (next[column]) next[column].rows = dragged(next[column].rows, row, wanted);
  return next;
}

/**
 * Puts something in a cell, or empties it (undefined). An agent is in one cell only, so it leaves its old one;
 * a terminal may be in as many cells as the person likes. A cell that stops holding a terminal drops its terminal's choices.
 */
export function assign(cols: Column[], column: number, row: number, holds: Holds | undefined): Column[] {
  const next = copy(cols);
  if (!next[column]?.rows[row]) return next;
  if (holds && holds !== 'terminal') {
    for (const c of next) for (const r of c.rows) if (r.holds === holds) delete r.holds;
  }
  const target = next[column].rows[row];
  if (holds !== 'terminal') delete target.terminal;
  if (holds) target.holds = holds;
  else delete target.holds;
  return next;
}

/** Sets which terminal a terminal cell opens; an empty one is the default. Unchanged for a cell that is not a terminal. */
export function setTerminal(cols: Column[], column: number, row: number, terminal: CellTerminal): Column[] {
  const next = copy(cols);
  const target = next[column]?.rows[row];
  if (!target || target.holds !== 'terminal') return next;
  if (isEmptyTerminal(terminal)) delete target.terminal;
  else target.terminal = { ...terminal };
  return next;
}

const cell = (size: number, row: Row): SavedNode => ({
  size,
  ...(row.holds ? { holds: row.holds } : {}),
  ...(row.terminal ? { terminal: { ...row.terminal } } : {}),
});

export const toSavedGrid = (cols: Column[]): SavedGrid => ({
  orientation: 0,
  groups: cols.map((c) =>
    c.rows.length === 1 ? cell(c.size, c.rows[0]) : { size: c.size, groups: c.rows.map((r) => cell(r.size, r)) },
  ),
});

/** The builder's form of a saved grid, or undefined if it is deeper or turned differently than the builder can show. */
export function fromSavedGrid(grid: SavedGrid): Column[] | undefined {
  if (grid.orientation !== 0) return undefined;
  const cols: Column[] = [];
  for (const node of grid.groups) {
    if (!node.groups) {
      cols.push({ size: node.size, rows: [cell(1, node)] });
      continue;
    }
    if (node.groups.some((r) => r.groups)) return undefined;
    cols.push({ size: node.size, rows: node.groups.map((r) => cell(r.size, r)) });
  }
  return cols;
}

/** What each cell holds, and for a terminal which terminal, in the grid's reading order (left to right, top to bottom within a column). */
export function cellsInOrder(grid: SavedGrid): { holds?: Holds; terminal?: CellTerminal }[] {
  const walk = (nodes: SavedNode[]): { holds?: Holds; terminal?: CellTerminal }[] =>
    nodes.flatMap((n) => (n.groups ? walk(n.groups) : [{ holds: n.holds, terminal: n.terminal }]));
  return walk(grid.groups);
}

/** Whether any terminal cell runs a startup command when it opens. */
export const hasStartupCommand = (grid: SavedGrid | undefined): boolean => !!grid && cellsInOrder(grid).some((c) => !!c.terminal?.command);

/** What each cell holds, in the grid's reading order. */
export const holdsInOrder = (grid: SavedGrid): (Holds | undefined)[] => cellsInOrder(grid).map((c) => c.holds);

const PLACE_NAMES = { left: 'the left side bar', right: 'the right side bar', panel: 'the bottom panel', column: 'a column' } as const;

/**
 * The rules tying agents' places to the cells: an agent placed in a column is in exactly one cell; an agent placed
 * anywhere else, or not chosen, is in none. Returns the first problem as a sentence, or undefined if all is well.
 */
export function validatePlaces(agents: AgentPlaces | undefined, grid: SavedGrid | undefined): string | undefined {
  const held = grid ? holdsInOrder(grid) : [];
  for (const id of AGENT_IDS) {
    const count = held.filter((h) => h === id).length;
    const place = agents?.[id];
    const { label } = AGENTS[id];
    if (place === 'column' && count !== 1) return `${label} is placed in a column, so it must be in exactly one cell of the grid`;
    if (place !== 'column' && count > 0) {
      return place ? `${label} is placed in ${PLACE_NAMES[place]}, so it cannot also be in a cell` : `${label} is in a cell but was not chosen`;
    }
  }
  return undefined;
}

/**
 * The towelwise.layout.grid setting: nothing saved gives undefined quietly; a grid that does not fit, or breaks the
 * place rules against the saved agents, is ignored as a whole and logged.
 */
export function parseLayoutGrid(raw: unknown, agents: AgentPlaces | undefined, log: (line: string) => void): SavedGrid | undefined {
  const grid = parseSavedGrid(raw, log);
  if (!grid) return undefined;
  const problem = validatePlaces(agents, grid);
  if (problem) {
    log(`ignored layout.grid: ${problem}`);
    return undefined;
  }
  return grid;
}
