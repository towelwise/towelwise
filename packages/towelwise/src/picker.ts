import * as vscode from 'vscode';
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
}

export interface SaveResult {
  written: string[];
  failed?: { option: string; message: string };
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

  constructor(
    private write: Write = writeGlobal,
    private env: SizeEnv = liveSizeEnv,
  ) {
    for (const { option } of OPTIONS) {
      const applied = section().get<boolean>(option, false);
      this.baseline.set(option, applied);
      this.value.set(option, applied);
    }
    const saved = parseSizes(section().get<unknown>('sizes'), () => undefined);
    this.percent = toPercents(saved);
    this.orientation = saved.panelOrientation;
    this.baselineSizes = JSON.stringify(this.sizesObject());
  }

  /** Finds out whether this window has the core bridge, so the size controls can say so. */
  async refreshLive(): Promise<void> {
    this.available = (await this.env.read()) !== undefined;
    this.note = this.available ? undefined : NEEDS_IDE;
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
  async useCurrentSizes(): Promise<void> {
    const state = await this.env.read();
    if (!state) {
      this.available = false;
      this.note = NEEDS_IDE;
      return;
    }
    this.available = true;
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
   * The value is set at once; the side is read on the same queue Save uses, so a Save pressed meanwhile waits for it.
   */
  setSize(part: string, text: string): Promise<void> {
    if (!(PARTS as readonly string[]).includes(part) || typeof text !== 'string') throw new Error(`Not a size: ${String(part)}`);
    const name = part as PartName;
    if (text.trim() === '') {
      delete this.percent[name];
      this.typed.delete(name);
      return Promise.resolve();
    }
    this.percent[name] = Number(text);
    this.typed.add(name);
    if (name !== 'panel') return Promise.resolve();
    const run = this.queue.then(async () => {
      const state = await this.env.read();
      if (state) this.orientation = orientationOf(state.panelPosition);
    });
    this.queue = run.catch(() => undefined);
    return run;
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

  items(): PickerItem[] {
    return OPTIONS.map((o) => {
      const inspected = section().inspect<boolean>(o.option);
      const overridden = inspected?.workspaceValue !== undefined || inspected?.workspaceFolderValue !== undefined;
      const on = this.value.get(o.option) === true;
      return o.kind === 'switch' ? { ...o, on, overridden } : { ...o, choice: on ? 'hide' : 'keep', overridden };
    });
  }

  savedOptions(): string[] {
    return [...OPTIONS.map((o) => o.option), 'sizes'].filter((option) => this.saved.has(option));
  }

  choose(option: string, choice: Choice): void {
    if (find(option).kind === 'switch') throw new Error(`${option} is a switch, not a hide option`);
    if (choice !== 'hide' && choice !== 'keep') throw new Error(`Not a choice: ${String(choice)}`);
    this.value.set(option, choice === 'hide');
  }

  setFullScreen(on: boolean): void {
    if (typeof on !== 'boolean') throw new Error('Full screen must be on or off');
    this.value.set('fullScreen', on);
  }

  // Saves run one after another: a Save pressed while another is writing waits, then sees what the first saved.
  private queue: Promise<unknown> = Promise.resolve();

  save(): Promise<SaveResult> {
    const run = this.queue.then(() => this.saveNow());
    this.queue = run.catch(() => undefined);
    return run;
  }

  // One option at a time, so a failure part-way leaves the earlier ones saved and the rest retryable.
  private async saveNow(): Promise<SaveResult> {
    const written: string[] = [];
    // Checked before anything is written, so a refused size changes nothing.
    const problem = this.sizesProblem();
    if (problem) return { written, failed: { option: 'sizes', message: problem } };
    for (const { option } of OPTIONS) {
      const draft = this.value.get(option) as boolean;
      if (draft === this.baseline.get(option)) continue;
      if (section().inspect<boolean>(option)?.globalValue !== draft) {
        try {
          await this.write(option, draft);
        } catch (e) {
          return { written, failed: { option, message: e instanceof Error ? e.message : String(e) } };
        }
        written.push(option);
        this.saved.add(option);
      }
      this.baseline.set(option, draft);
    }
    const sizes = this.sizesObject();
    const json = JSON.stringify(sizes);
    if (json !== this.baselineSizes) {
      try {
        await this.env.write(Object.keys(sizes).length > 0 ? sizes : undefined);
      } catch (e) {
        return { written, failed: { option: 'sizes', message: e instanceof Error ? e.message : String(e) } };
      }
      written.push('sizes');
      this.saved.add('sizes');
      this.baselineSizes = json;
    }
    return { written };
  }
}

export type Message =
  | { type: 'ready' | 'save' | 'cancel' }
  | { type: 'choose'; option: string; choice: Choice }
  | { type: 'fullScreen'; on: boolean }
  | { type: 'useCurrentSizes' }
  | { type: 'size'; part: PartName; value: string };

// The page is untrusted input: anything that is not exactly one of these messages is dropped.
export function parseMessage(raw: unknown): Message | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const m = raw as Record<string, unknown>;
  if (m.type === 'ready' || m.type === 'save' || m.type === 'cancel' || m.type === 'useCurrentSizes') return { type: m.type };
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
}

// default-src 'none' means no network, no frames and no inline script: only the two local files load.
export function pageHtml({ cspSource, nonce, scriptUri, styleUri }: PageParts): string {
  const csp = `default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}';`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${styleUri}">
<title>Edit Hyperspace Layout</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
