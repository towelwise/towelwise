// What the Choose Layout page edits: agents and where they live, the editor columns, and the side bar and panel
// sizes. Pure logic apart from the environment it is given, so it is tested without a window. Nothing is written until
// Save, and everything that touches the environment runs on one queue, in arrival order, as the hyperspace page's does.
import { AGENTS, AGENT_IDS, AgentId, AgentPlaces, HOLDS, Holds, PLACES, Place } from './agents';
import { CellTerminal, SHELL_LABELS, TerminalShell, parseCellTerminal } from './cellTerminal';
import {
  Column,
  MIN_CELL,
  addColumn,
  addRow,
  assign,
  canAddColumn,
  canAddRow,
  defaultColumns,
  dragColumnEdge,
  dragRowEdge,
  fromSavedGrid,
  removeColumn,
  removeRow,
  setTerminal,
  toSavedGrid,
  validatePlaces,
} from './columns';
import { SavedGrid } from './grid';
import type { MyLayout } from './myLayout';
import { LayoutState, Orientation, PARTS, PartName, Sizes, orientationOf, toProportions, validateTyped } from './sizes';

/** The window and the settings, as the draft needs them, so tests can stand in for both. */
export interface LayoutEnv {
  /** The window's current layout through the core bridge; undefined if there is none. */
  read(): PromiseLike<LayoutState | undefined>;
  /** Saves the three layout settings; an empty object clears one. */
  write(values: { agents: AgentPlaces; grid: SavedGrid | Record<string, never>; sizes: Sizes }): PromiseLike<void>;
}

// stale: something was changed, or an edit was still queued, while Save was working, so what was saved is what the page
// showed when Save was pressed.
export type SaveResult = { ok: true; stale?: true } | { ok: false; problem: string };

const SIZE_LABELS: Record<PartName, string> = { sidebar: 'Primary side bar', auxiliarybar: 'Secondary side bar', panel: 'Bottom panel' };
const KEPT_NOTE =
  'This grid has nested columns or rows that this page cannot draw. It is kept exactly as it is. Edit it in settings, or press Start over to build a new one here.';

const percentText = (p: number | undefined) => (p === undefined ? '' : String(Math.round(p * 10) / 10));
const emptied = (cols: Column[], id: AgentId): Column[] =>
  cols.map((c) => ({ size: c.size, rows: c.rows.map((r) => (r.holds === id ? { size: r.size } : { ...r })) }));

export class LayoutDraft {
  private places: AgentPlaces;
  private cols: Column[] | undefined;
  // A saved grid the builder cannot show. It is saved back unchanged unless the person starts over.
  private kept: SavedGrid | undefined;
  private percent: Partial<Record<PartName, number>> = {};
  private typed = new Set<PartName>();
  private orientation: Orientation | undefined;
  private sizesAvailable = true;
  // The shells this machine has, once they are known.
  private shells: TerminalShell[] | undefined;
  // Why the last change was refused, shown until the next change that works.
  private notice: string | undefined;
  // Counts changes, so Save can tell whether the draft moved on while it was waiting for the window.
  private revision = 0;
  private queue: Promise<unknown> = Promise.resolve();
  // Edits queued but not started: one sent while Save is writing changes the draft only after Save is done.
  private waiting = 0;

  constructor(
    saved: MyLayout | undefined,
    private readonly env: LayoutEnv,
  ) {
    this.places = { ...saved?.agents };
    if (saved?.grid) {
      const cols = fromSavedGrid(saved.grid);
      if (cols) this.cols = cols;
      else this.kept = saved.grid;
    }
    for (const part of PARTS) {
      const proportion = saved?.sizes?.[part];
      if (proportion !== undefined) this.percent[part] = proportion * 100;
    }
    this.orientation = saved?.sizes?.panelOrientation;
    // An agent in a column needs columns to be in, even if the saved grid was missing or unusable.
    if (Object.values(this.places).includes('column')) this.useColumns();
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    this.waiting++;
    const start = () => (this.waiting--, task());
    const run = this.queue.then(start, start);
    this.queue = run.catch(() => undefined);
    return run;
  }

  setPlace(id: AgentId, place: Place | undefined): void {
    this.revision++;
    if (place) this.places[id] = place;
    else delete this.places[id];
    if (place === 'column') this.useColumns();
    else if (this.cols) this.cols = emptied(this.cols, id);
  }

  useColumns(): void {
    this.revision++;
    if (!this.cols && !this.kept) this.cols = defaultColumns();
  }

  removeColumns(): void {
    this.revision++;
    this.cols = undefined;
    this.kept = undefined;
  }

  startOver(): void {
    this.revision++;
    this.kept = undefined;
    this.cols = defaultColumns();
  }

  addColumn(side: 'left' | 'right'): void {
    this.revision++;
    if (!this.cols) return;
    if (!canAddColumn(this.cols)) {
      this.notice = `There is no room for another column: each must stay at least ${MIN_CELL * 100}% of the width.`;
      return;
    }
    this.notice = undefined;
    this.cols = addColumn(this.cols, side);
  }

  removeColumn(index: number): void {
    this.revision++;
    if (this.cols) this.cols = removeColumn(this.cols, index);
  }

  addRow(column: number, row: number): void {
    this.revision++;
    if (!this.cols) return;
    if (!canAddRow(this.cols, column, row)) {
      this.notice = `That row is too small to split: each must stay at least ${MIN_CELL * 100}% of the column's height.`;
      return;
    }
    this.notice = undefined;
    this.cols = addRow(this.cols, column, row);
  }

  removeRow(column: number, row: number): void {
    this.revision++;
    if (this.cols) this.cols = removeRow(this.cols, column, row);
  }

  dragEdge(axis: 'column' | 'row', column: number, row: number | undefined, size: number): void {
    this.revision++;
    if (!this.cols) return;
    this.cols = axis === 'column' ? dragColumnEdge(this.cols, column, size) : dragRowEdge(this.cols, column, row ?? 0, size);
  }

  /** Only an agent placed in a column can be in a cell. */
  assign(column: number, row: number, holds: Holds | undefined): void {
    this.revision++;
    if (!this.cols) return;
    if (holds && holds !== 'terminal' && this.places[holds] !== 'column') return;
    this.cols = assign(this.cols, column, row, holds);
  }

  /** Which terminal a terminal cell opens. */
  setTerminal(column: number, row: number, terminal: CellTerminal): void {
    this.revision++;
    if (this.cols) this.cols = setTerminal(this.cols, column, row, terminal);
  }

  /** The shells found on this machine, offered for terminal cells. */
  setShells(shells: TerminalShell[]): void {
    this.shells = [...shells];
  }

  // A cell's terminal fields, with the shells to offer: this machine's, and the saved one even if it is not found.
  // Until the machine's shells are known, only Default and the saved one are offered, and nothing is marked missing.
  private terminalView(terminal: CellTerminal | undefined) {
    const shell: TerminalShell = terminal?.shell ?? 'default';
    const offered: TerminalShell[] = this.shells ? [...this.shells] : ['default'];
    if (!offered.includes(shell)) offered.push(shell);
    return {
      shell,
      name: terminal?.name ?? '',
      folder: terminal?.folder ?? '',
      command: terminal?.command ?? '',
      placeholder: SHELL_LABELS[shell],
      shells: offered.map((value) => ({
        value,
        label: this.shells && !this.shells.includes(value) ? `${SHELL_LABELS[value]} (not found)` : SHELL_LABELS[value],
      })),
    };
  }

  /** A typed percentage; empty clears it. The panel's side is read at Save, so it is the side then. */
  setSize(part: PartName, text: string): Promise<void> {
    return this.enqueue(async () => {
      this.revision++;
      if (text.trim() === '') {
        delete this.percent[part];
        this.typed.delete(part);
      } else {
        this.percent[part] = Number(text);
        this.typed.add(part);
      }
    });
  }

  /** Fills the sizes of the parts that are visible now; a size not visible is left as it is. */
  useCurrentSizes(): Promise<void> {
    return this.enqueue(async () => {
      this.revision++;
      const state = await this.env.read();
      this.sizesAvailable = state !== undefined;
      if (!state) return;
      const current = toProportions(state);
      for (const part of PARTS) {
        if (current[part] === undefined) continue;
        this.percent[part] = current[part]! * 100;
        this.typed.delete(part);
      }
      this.orientation = current.panelOrientation ?? this.orientation;
    });
  }

  view() {
    const agentsInColumns = AGENT_IDS.filter((id) => this.places[id] === 'column');
    const choices = [
      { value: '', label: 'Empty' },
      ...agentsInColumns.map((id) => ({ value: id, label: AGENTS[id].label })),
      { value: 'terminal', label: 'Terminal' },
    ];
    return {
      agents: AGENT_IDS.map((id) => ({ id, label: AGENTS[id].label, place: this.places[id] ?? '' })),
      grid: {
        on: Boolean(this.cols || this.kept),
        kept: Boolean(this.kept),
        note: this.kept ? KEPT_NOTE : undefined,
        notice: this.notice,
        columns: this.cols?.map((c) => ({
          size: c.size,
          rows: c.rows.map((r) => ({
            size: r.size,
            holds: r.holds ?? '',
            choices,
            ...(r.holds === 'terminal' ? { terminal: this.terminalView(r.terminal) } : {}),
          })),
        })),
      },
      sizes: {
        available: this.sizesAvailable,
        rows: PARTS.map((part) => ({ part, label: SIZE_LABELS[part], percent: percentText(this.percent[part]), typed: this.typed.has(part) })),
      },
    };
  }

  /** Checks everything first and writes nothing if anything is wrong; the problem is a sentence for the person. */
  save(): Promise<SaveResult> {
    return this.enqueue(async (): Promise<SaveResult> => {
      // Everything saved is taken here, before the first wait, so the agents, the grid and the sizes are one moment of
      // the draft even if the person changes something while the window is being read.
      const at = this.revision;
      const places = { ...this.places };
      const grid = this.kept ?? (this.cols ? toSavedGrid(this.cols) : undefined);
      const percent = { ...this.percent };
      const typed = new Set(this.typed);
      let orientation = this.orientation;
      const sizeProblem = validateTyped(percent, typed);
      if (sizeProblem) return { ok: false, problem: sizeProblem };
      const placeProblem = validatePlaces(places, grid);
      if (placeProblem) return { ok: false, problem: placeProblem };
      if (typed.has('panel')) {
        const state = await this.env.read();
        if (!state) return { ok: false, problem: "The bottom panel's side could not be read, so its size cannot be saved. Clear it, or use Use current sizes." };
        orientation = orientationOf(state.panelPosition);
        this.orientation = orientation;
      }
      const sizes: Sizes = {};
      for (const part of PARTS) {
        const p = percent[part];
        if (p === undefined) continue;
        if (part !== 'panel') sizes[part] = p / 100;
        else if (orientation) {
          sizes.panel = p / 100;
          sizes.panelOrientation = orientation;
        }
      }
      await this.env.write({ agents: places, grid: grid ?? {}, sizes });
      return this.revision === at && this.waiting === 0 ? { ok: true } : { ok: true, stale: true };
    });
  }
}

export type LayoutMessage =
  | { type: 'ready' | 'save' | 'cancel' | 'restore' | 'reload' | 'useCurrentSizes' | 'useColumns' | 'removeColumns' | 'startOver' }
  | { type: 'place'; agent: AgentId; place: Place | '' }
  | { type: 'addColumn'; side: 'left' | 'right' }
  | { type: 'removeColumn'; index: number }
  | { type: 'addRow' | 'removeRow'; column: number; row: number }
  | { type: 'drag'; axis: 'column'; column: number; size: number }
  | { type: 'drag'; axis: 'row'; column: number; row: number; size: number }
  | { type: 'assign'; column: number; row: number; holds: Holds | '' }
  | { type: 'terminal'; column: number; row: number; terminal: CellTerminal }
  | { type: 'size'; part: PartName; value: string };

const isIndex = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isSize = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// The page is untrusted input: anything that is not exactly one of these messages is dropped.
export function parseLayoutMessage(raw: unknown): LayoutMessage | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case 'ready':
    case 'save':
    case 'cancel':
    case 'restore':
    case 'reload':
    case 'useCurrentSizes':
    case 'useColumns':
    case 'removeColumns':
    case 'startOver':
      return { type: m.type };
    case 'place':
      if (AGENT_IDS.includes(m.agent as AgentId) && (m.place === '' || PLACES.includes(m.place as Place))) {
        return { type: 'place', agent: m.agent as AgentId, place: m.place as Place | '' };
      }
      return undefined;
    case 'addColumn':
      return m.side === 'left' || m.side === 'right' ? { type: 'addColumn', side: m.side } : undefined;
    case 'removeColumn':
      return isIndex(m.index) ? { type: 'removeColumn', index: m.index } : undefined;
    case 'addRow':
    case 'removeRow':
      return isIndex(m.column) && isIndex(m.row) ? { type: m.type, column: m.column, row: m.row } : undefined;
    case 'drag':
      if (m.axis === 'column' && isIndex(m.column) && isSize(m.size)) return { type: 'drag', axis: 'column', column: m.column, size: m.size };
      if (m.axis === 'row' && isIndex(m.column) && isIndex(m.row) && isSize(m.size)) {
        return { type: 'drag', axis: 'row', column: m.column, row: m.row, size: m.size };
      }
      return undefined;
    case 'assign':
      if (isIndex(m.column) && isIndex(m.row) && (m.holds === '' || HOLDS.includes(m.holds as Holds))) {
        return { type: 'assign', column: m.column, row: m.row, holds: m.holds as Holds | '' };
      }
      return undefined;
    case 'terminal': {
      const terminal = parseCellTerminal(m.terminal);
      return isIndex(m.column) && isIndex(m.row) && terminal ? { type: 'terminal', column: m.column, row: m.row, terminal } : undefined;
    }
    case 'size':
      return typeof m.value === 'string' && (PARTS as readonly unknown[]).includes(m.part) ? { type: 'size', part: m.part as PartName, value: m.value } : undefined;
    default:
      return undefined;
  }
}
