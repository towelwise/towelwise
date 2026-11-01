import * as vscode from 'vscode';

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

  constructor(private write: Write = writeGlobal) {
    for (const { option } of OPTIONS) {
      const applied = section().get<boolean>(option, false);
      this.baseline.set(option, applied);
      this.value.set(option, applied);
    }
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
    return OPTIONS.map((o) => o.option).filter((option) => this.saved.has(option));
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
    return { written };
  }
}

export type Message =
  | { type: 'ready' | 'save' | 'cancel' }
  | { type: 'choose'; option: string; choice: Choice }
  | { type: 'fullScreen'; on: boolean };

// The page is untrusted input: anything that is not exactly one of these messages is dropped.
export function parseMessage(raw: unknown): Message | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const m = raw as Record<string, unknown>;
  if (m.type === 'ready' || m.type === 'save' || m.type === 'cancel') return { type: m.type };
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
