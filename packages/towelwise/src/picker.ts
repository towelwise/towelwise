import * as vscode from 'vscode';
import { AGENTS, AgentId } from './agents';
import { Layout, SavedGrid, attachLabels, leafCount, parseLayout, parseSavedGrid, toSaved } from './grid';
import { AREAS } from './hyperspace';
import { agentsByPart, readLayout } from './savedLayout';
import { LayoutState, Orientation, PARTS, PartName, Sizes, orientationOf, parseLayoutState, parseSizes, toProportions, validateTyped } from './sizes';

// What the Edit Hyperspace Layout page edits: which items hyperspace hides, plus the full-screen switch.
// Only these nine towelwise.hyperspace.* options can ever be written from the page.
export type Choice = 'hide' | 'keep';

interface Option {
  option: string;
  label: string;
  kind: 'chrome' | 'area' | 'switch';
}

export const OPTIONS: readonly Option[] = [
  { option: 'hideActivityBar', label: 'Activity bar', kind: 'chrome' },
  { option: 'hideStatusBar', label: 'Status bar', kind: 'chrome' },
  { option: 'hideMenuBar', label: 'Menu bar', kind: 'chrome' },
  { option: 'hideCommandCenter', label: 'Palette box', kind: 'chrome' },
  { option: 'hideLayoutControls', label: 'Layout buttons', kind: 'chrome' },
  { option: 'hidePrimarySideBar', label: 'Primary side bar', kind: 'area' },
  { option: 'hideSecondarySideBar', label: 'Secondary side bar', kind: 'area' },
  { option: 'hideBottomPanel', label: 'Bottom panel', kind: 'area' },
  { option: 'fullScreen', label: 'Full screen', kind: 'switch' },
];

// For a hide option, choice is Hide when it is on. For the full-screen switch, on is its value.
export interface PickerItem extends Option {
  choice?: Choice;
  on?: boolean;
  overridden: boolean;
  // Set for an area the saved layout puts agents in: shown as Keep and not changeable, with the reason.
  locked?: string;
}

export interface SaveResult {
  written: string[];
  failed?: { option: string; message: string };
  // Areas the layout put an agent in after the page was opened, so their choice was not saved.
  skipped?: { option: string; reason: string }[];
}

type Write = (option: string, value: boolean) => PromiseLike<void>;

// What the size controls need from the window: its live layout (undefined without the core bridge), and the setting.
export interface SizeEnv {
  read(): PromiseLike<LayoutState | undefined>;
  write(value: Sizes | undefined): PromiseLike<void>;
}

const liveSizeEnv: SizeEnv = {
  read: async () => {
    try {
      return parseLayoutState(await vscode.commands.executeCommand('_towelwise.layout.state'));
    } catch {
      return undefined;
    }
  },
  write: (value) => section().update('sizes', value, vscode.ConfigurationTarget.Global),
};

// What the editor grid controls need: the live grid with a label per cell (in the grid's order), and the setting.
export interface GridEnv {
  read(): PromiseLike<{ layout: Layout; labels: string[] } | undefined>;
  write(value: SavedGrid | undefined): PromiseLike<void>;
}

// A tab's name for the picker's mock: the agents by name, a terminal as Terminal, anything else by its own title.
function tabLabel(tab: vscode.Tab | undefined): string {
  const input = tab?.input;
  if (input instanceof vscode.TabInputWebview && input.viewType.includes('claudeVSCodePanel')) return 'Claude Code';
  if (input instanceof vscode.TabInputCustom && input.viewType === 'chatgpt.conversationEditor') return 'Codex';
  if (input instanceof vscode.TabInputTerminal) return 'Terminal';
  return tab?.label ?? '';
}

const liveGridEnv: GridEnv = {
  read: async () => {
    try {
      const layout = parseLayout(await vscode.commands.executeCommand('vscode.getEditorLayout'));
      if (!layout) return undefined;
      // Groups are numbered in the grid's reading order, but the list is not.
      const groups = [...vscode.window.tabGroups.all].sort((a, b) => a.viewColumn - b.viewColumn);
      return { layout, labels: groups.map((g) => tabLabel(g.activeTab)) };
    } catch {
      return undefined;
    }
  },
  write: (value) => section().update('editorGrid', value, vscode.ConfigurationTarget.Global),
};

// What the picker needs to know about the saved layout: whether one is saved, and the agents it puts in each part.
export interface LayoutView {
  saved: boolean;
  agents: Record<PartName, AgentId[]>;
}

export interface LayoutEnv {
  /** The saved layout as it is now. */
  read(): LayoutView;
  /** Runs the work while no layout can be saved in any window; false, without running it, if one is busy. */
  hold(work: () => Promise<void>): Promise<boolean>;
}

/** Reads the saved layout from the settings. Its hold does not lock; the page passes one that locks across windows. */
export const liveLayoutEnv: LayoutEnv = {
  read: () => {
    const saved = readLayout(() => undefined);
    const right = vscode.workspace.getConfiguration('workbench').get('sideBar.location') === 'right';
    return { saved: saved !== undefined, agents: agentsByPart(saved, right) };
  },
  hold: async (work) => (await work(), true),
};

const partOf = (option: string) => AREAS.find((area) => area.option === option)?.part;

const NEEDS_IDE = 'Sizes need Towelwise AI, the IDE. They cannot be set from plain VS Code.';

export const SIZE_LABELS: Record<PartName, string> = {
  sidebar: 'Primary side bar width',
  auxiliarybar: 'Secondary side bar width',
  panel: 'Bottom panel size',
};

export interface SizeRow {
  part: PartName;
  label: string;
  percent?: number;
  typed: boolean;
}

export interface SizesView {
  available: boolean;
  rows: SizeRow[];
  panelOrientation?: Orientation;
  note?: string;
}

const toPercents = (sizes: Sizes): Partial<Record<PartName, number>> => {
  const out: Partial<Record<PartName, number>> = {};
  for (const part of PARTS) if (sizes[part] !== undefined) out[part] = (sizes[part] as number) * 100;
  return out;
};

const section = () => vscode.workspace.getConfiguration('towelwise.hyperspace');

const writeGlobal: Write = (option, value) => section().update(option, value, vscode.ConfigurationTarget.Global);

const find = (option: string) => {
  const found = OPTIONS.find((o) => o.option === option);
  if (!found) throw new Error(`Not a hyperspace option: ${option}`);
  return found;
};

// The draft lives in the extension, not the page, so it survives the page being hidden and shown again.
export class Draft {
  // Values the panel opened with, or last saved: an option counts as edited only when the draft differs from it.
  private baseline = new Map<string, boolean>();
  private value = new Map<string, boolean>();
  // Options this Draft has written, so the page can show what stays saved even if the rest is cancelled.
  private saved = new Set<string>();

  // Sizes are percentages. A value is captured when Use current sizes filled it and typed once edited by hand;
  // only typed values are range checked on Save.
  private percent: Partial<Record<PartName, number>> = {};
  private typed = new Set<PartName>();
  private orientation?: Orientation;
  private baselineSizes = '{}';
  private available = false;
  private note?: string;
  // What is open in each area, from the last live read that worked. Display only.
  private names: Partial<Record<PartName, string>> = {};

  // The editor grid as drafted; undefined means none is saved.
  private grid?: SavedGrid;
  private baselineGrid = '';
  private gridNote?: string;

  // The saved layout as read when the page opened and each time it is shown again; Save reads it once more before writing.
  private view: LayoutView;

  constructor(
    private write: Write = writeGlobal,
    private env: SizeEnv = liveSizeEnv,
    private grids: GridEnv = liveGridEnv,
    private layout: LayoutEnv = liveLayoutEnv,
  ) {
    this.view = layout.read();
    for (const { option } of OPTIONS) {
      const applied = section().get<boolean>(option, false);
      this.baseline.set(option, applied);
      this.value.set(option, applied);
    }
    const saved = parseSizes(section().get<unknown>('sizes'), () => undefined);
    this.percent = toPercents(saved);
    this.orientation = saved.panelOrientation;
    this.baselineSizes = JSON.stringify(this.sizesObject());
    this.grid = parseSavedGrid(section().get<unknown>('editorGrid'), () => undefined);
    this.baselineGrid = JSON.stringify(this.grid ?? null);
  }

  /** Whether a layout is saved, so its sizes and editor grid apply and the page shows a note in place of those sections. */
  layoutSaved(): boolean {
    return this.view.saved;
  }

  gridView(): { saved?: SavedGrid; note?: string } {
    return { saved: this.grid, note: this.gridNote };
  }

  /**
   * Reads the live editor area and drafts its columns and rows as proportions, labelled by what each cell holds.
   * It runs on the queue Save uses, so Clear and Save pressed meanwhile are ordered after it.
   */
  useCurrentLayout(): Promise<void> {
    return this.enqueue(async () => {
      const read = await this.grids.read();
      if (!read) {
        this.gridNote = 'Could not read the editor layout.';
        return;
      }
      const grid = attachLabels(toSaved(read.layout), read.labels);
      this.grid = grid;
      this.gridNote =
        leafCount(grid) === 1 ? 'Only one editor group is open, so there is nothing to apply.' : 'Filled from the current layout.';
    });
  }

  /** Drops the drafted grid, so hyperspace leaves the editor area's columns and rows alone. */
  clearGrid(): Promise<void> {
    return this.enqueue(() => {
      this.grid = undefined;
      this.gridNote = 'No editor grid will be saved.';
    });
  }

  /** Finds out whether this window has the core bridge, so the size controls can say so. */
  async refreshLive(): Promise<void> {
    this.view = this.layout.read();
    const state = await this.env.read();
    this.available = state !== undefined;
    this.note = this.available ? undefined : NEEDS_IDE;
    if (state) this.readNames(state);
  }

  // A failed read keeps the old names; an area that is closed or unnamed goes back to its plain name.
  private readNames(state: LayoutState): void {
    this.names = {};
    for (const part of PARTS) {
      const title = state.parts[part].container?.title;
      if (title) this.names[part] = title;
    }
  }

  namesView(): Partial<Record<PartName, string>> {
    return { ...this.names };
  }

  sizesView(): SizesView {
    return {
      available: this.available,
      note: this.note,
      panelOrientation: this.orientation,
      rows: PARTS.map((part) => ({ part, label: SIZE_LABELS[part], percent: this.percent[part], typed: this.typed.has(part) })),
    };
  }

  /** Reads the live window and fills the visible parts' sizes as percentages. A hidden part keeps its value. */
  useCurrentSizes(): Promise<void> {
    return this.enqueue(() => this.readSizes());
  }

  private async readSizes(): Promise<void> {
    const state = await this.env.read();
    if (!state) {
      this.available = false;
      this.note = NEEDS_IDE;
      return;
    }
    this.available = true;
    this.readNames(state);
    const read = toProportions(state);
    const hidden: string[] = [];
    for (const part of PARTS) {
      const proportion = read[part];
      if (proportion === undefined) {
        hidden.push(SIZE_LABELS[part]);
        continue;
      }
      this.percent[part] = proportion * 100;
      this.typed.delete(part);
    }
    if (read.panel !== undefined) this.orientation = orientationOf(state.panelPosition);
    this.note = hidden.length > 0 ? `Not open right now, so left as they were: ${hidden.join(', ')}.` : 'Filled from the current window.';
  }

  /**
   * Sets one size from text the person typed. Empty clears it, meaning hyperspace leaves that part alone. A typed
   * panel size belongs to the side the panel is on now, so that is read again; without a live read, the old side stays.
   * The whole edit runs on the queue Save and the captures use, so it is ordered with them: a capture started
   * earlier cannot overwrite it, and a Save pressed meanwhile waits for it.
   */
  setSize(part: string, text: string): Promise<void> {
    if (!(PARTS as readonly string[]).includes(part) || typeof text !== 'string') throw new Error(`Not a size: ${String(part)}`);
    const name = part as PartName;
    return this.enqueue(async () => {
      if (text.trim() === '') {
        delete this.percent[name];
        this.typed.delete(name);
        return;
      }
      this.percent[name] = Number(text);
      this.typed.add(name);
      if (name === 'panel') {
        const state = await this.env.read();
        if (state) this.orientation = orientationOf(state.panelPosition);
      }
    });
  }

  private sizesObject(): Sizes {
    const out: Sizes = {};
    for (const part of PARTS) if (this.percent[part] !== undefined) out[part] = (this.percent[part] as number) / 100;
    if (out.panel !== undefined && this.orientation) out.panelOrientation = this.orientation;
    return out;
  }

  // A message, or undefined if the sizes can be saved.
  private sizesProblem(): string | undefined {
    const problem = validateTyped(this.percent, this.typed);
    if (problem) return problem;
    if (this.percent.panel !== undefined && !this.orientation) {
      return 'The bottom panel size needs to know which side the panel is on. Press Use current sizes with the panel open.';
    }
    return undefined;
  }

  // "Codex lives here", or undefined when the layout puts nothing in the area. A stored Hide is left as it is.
  private lockedReason(option: string): string | undefined {
    const part = partOf(option);
    const agents = part ? this.view.agents[part] : [];
    if (agents.length === 0) return undefined;
    return `${agents.map((id) => AGENTS[id].label).join(' and ')} ${agents.length === 1 ? 'lives' : 'live'} here`;
  }

  items(): PickerItem[] {
    return OPTIONS.map((o) => {
      const inspected = section().inspect<boolean>(o.option);
      const overridden = inspected?.workspaceValue !== undefined || inspected?.workspaceFolderValue !== undefined;
      const on = this.value.get(o.option) === true;
      if (o.kind === 'switch') return { ...o, on, overridden };
      const locked = this.lockedReason(o.option);
      return locked ? { ...o, choice: 'keep', locked, overridden } : { ...o, choice: on ? 'hide' : 'keep', overridden };
    });
  }

  /** Whether the draft holds anything Save has not written, such as a choice changed while Save was writing. */
  unsaved(): boolean {
    if (this.waiting > 0 || OPTIONS.some(({ option }) => this.value.get(option) !== this.baseline.get(option))) return true;
    // A saved layout owns sizes and the editor grid, so Save leaves those drafts unwritten on purpose.
    if (this.view.saved) return false;
    return JSON.stringify(this.sizesObject()) !== this.baselineSizes || JSON.stringify(this.grid ?? null) !== this.baselineGrid;
  }

  savedOptions(): string[] {
    return [...OPTIONS.map((o) => o.option), 'sizes', 'editorGrid'].filter((option) => this.saved.has(option));
  }

  choose(option: string, choice: Choice): void {
    if (find(option).kind === 'switch') throw new Error(`${option} is a switch, not a hide option`);
    if (choice !== 'hide' && choice !== 'keep') throw new Error(`Not a choice: ${String(choice)}`);
    const locked = this.lockedReason(option);
    if (locked) throw new Error(`${find(option).label} is in use by your layout (${locked}), so hyperspace keeps it`);
    this.value.set(option, choice === 'hide');
  }

  setFullScreen(on: boolean): void {
    if (typeof on !== 'boolean') throw new Error('Full screen must be on or off');
    this.value.set('fullScreen', on);
  }

  // Saves and every edit that reads the live window run one after another, in the order they arrive: a Save pressed
  // while a capture is reading waits and then saves what the capture drafted, and one pressed while another is
  // writing waits and then sees what the first saved.
  private queue: Promise<unknown> = Promise.resolve();

  // Jobs queued but not started, so unsaved() counts an edit waiting behind a Save.
  private waiting = 0;

  private enqueue<T>(job: () => Promise<T> | T): Promise<T> {
    this.waiting++;
    const run = this.queue.then(() => (this.waiting--, job()));
    this.queue = run.catch(() => undefined);
    return run;
  }

  save(): Promise<SaveResult> {
    return this.enqueue(() => this.saveNow());
  }

  // Under the lock layout saves use, so no layout can be saved in any window between the in-use check and the write it guards.
  private async saveNow(): Promise<SaveResult> {
    let result: SaveResult = { written: [] };
    const held = await this.layout.hold(async () => {
      result = await this.saveHeld();
    });
    return held ? result : { written: [], failed: { option: 'hyperspace', message: 'Another Towelwise window is busy with a layout. Try saving again in a moment.' } };
  }

  // One option at a time, so a failure part-way leaves the earlier ones saved and the rest retryable.
  private async saveHeld(): Promise<SaveResult> {
    const written: string[] = [];
    const skipped: { option: string; reason: string }[] = [];
    const finish = (failed?: SaveResult['failed']): SaveResult => ({ written, ...(failed && { failed }), ...(skipped.length > 0 && { skipped }) });
    // Each read replaces the page's view, so the state sent back after Save shows the layout Save acted on.
    this.view = this.layout.read();
    // Checked before anything is written, so a refused size changes nothing. A saved layout owns the sizes, so a draft
    // the page no longer shows cannot refuse the rest.
    const problem = this.view.saved ? undefined : this.sizesProblem();
    if (problem) return { written, failed: { option: 'sizes', message: problem } };
    for (const { option } of OPTIONS) {
      const draft = this.value.get(option) as boolean;
      if (draft === this.baseline.get(option)) continue;
      // Read again for each area just before its write: a layout saved meanwhile may have put an agent there.
      this.view = this.layout.read();
      const reason = this.lockedReason(option);
      if (reason) {
        skipped.push({ option, reason });
        this.value.set(option, this.baseline.get(option) as boolean);
        continue;
      }
      if (section().inspect<boolean>(option)?.globalValue !== draft) {
        try {
          await this.write(option, draft);
        } catch (e) {
          return finish({ option, message: e instanceof Error ? e.message : String(e) });
        }
        written.push(option);
        this.saved.add(option);
      }
      this.baseline.set(option, draft);
    }
    // A layout saved meanwhile owns sizes and the editor grid: the drafts stay as they are and the stored values are not touched.
    this.view = this.layout.read();
    if (this.view.saved) return finish();
    const sizes = this.sizesObject();
    const json = JSON.stringify(sizes);
    if (json !== this.baselineSizes) {
      try {
        await this.env.write(Object.keys(sizes).length > 0 ? sizes : undefined);
      } catch (e) {
        return finish({ option: 'sizes', message: e instanceof Error ? e.message : String(e) });
      }
      written.push('sizes');
      this.saved.add('sizes');
      this.baselineSizes = json;
    }
    const gridJson = JSON.stringify(this.grid ?? null);
    if (gridJson !== this.baselineGrid) {
      try {
        await this.grids.write(this.grid);
      } catch (e) {
        return finish({ option: 'editorGrid', message: e instanceof Error ? e.message : String(e) });
      }
      written.push('editorGrid');
      this.saved.add('editorGrid');
      this.baselineGrid = gridJson;
    }
    return finish();
  }
}

export type Message =
  | { type: 'ready' | 'save' | 'cancel' }
  | { type: 'choose'; option: string; choice: Choice }
  | { type: 'fullScreen'; on: boolean }
  | { type: 'useCurrentSizes' | 'useCurrentLayout' | 'clearGrid' | 'chooseLayout' }
  | { type: 'size'; part: PartName; value: string };

// The page is untrusted input: anything that is not exactly one of these messages is dropped.
export function parseMessage(raw: unknown): Message | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const m = raw as Record<string, unknown>;
  if (m.type === 'ready' || m.type === 'save' || m.type === 'cancel' || m.type === 'useCurrentSizes' || m.type === 'useCurrentLayout' || m.type === 'clearGrid' || m.type === 'chooseLayout') return { type: m.type };
  if (m.type === 'size' && typeof m.value === 'string' && PARTS.includes(m.part as PartName)) {
    return { type: 'size', part: m.part as PartName, value: m.value };
  }
  if (m.type === 'fullScreen' && typeof m.on === 'boolean') return { type: 'fullScreen', on: m.on };
  if (m.type === 'choose' && typeof m.option === 'string' && (m.choice === 'hide' || m.choice === 'keep')) {
    const known = OPTIONS.find((o) => o.option === m.option);
    if (known && known.kind !== 'switch') return { type: 'choose', option: m.option, choice: m.choice };
  }
  return undefined;
}

export interface PageParts {
  cspSource: string;
  nonce: string;
  scriptUri: string;
  styleUri: string;
  // The page's title; the hyperspace page's when not given.
  title?: string;
}

// default-src 'none' means no network, no frames and no inline script: only the two local files load.
export function pageHtml({ cspSource, nonce, scriptUri, styleUri, title = 'Edit Hyperspace Layout' }: PageParts): string {
  const csp = `default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}';`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${styleUri}">
<title>${title}</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
