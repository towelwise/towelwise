import { Draft, OPTIONS, PickerItem, SaveResult } from './picker';

export interface LayoutModeState {
  items: PickerItem[];
  saved: string[];
  hyperspaceOn: boolean;
}

// What the Towelwise AI workbench patch talks to. The patch draws boxes and forwards clicks; every rule about
// Keep and Hide, the draft, Save and failures lives in Draft. This class only checks what the patch sends.
export class LayoutMode {
  private draft?: Draft;

  constructor(
    private makeDraft: () => Draft,
    private hyperspaceOn: () => boolean,
  ) {}

  private current(): Draft {
    return (this.draft ??= this.makeDraft());
  }

  // A fresh draft from the settings as they are now.
  open(): void {
    this.draft = this.makeDraft();
  }

  close(): void {
    this.draft = undefined;
  }

  state(): LayoutModeState {
    const draft = this.current();
    return { items: draft.items(), saved: draft.savedOptions(), hyperspaceOn: this.hyperspaceOn() };
  }

  // The pair must match: Keep or Hide for a hide option, on or off for full screen. Anything else changes nothing.
  choose(option: unknown, value: unknown): LayoutModeState {
    const known = typeof option === 'string' ? OPTIONS.find((o) => o.option === option) : undefined;
    if (!known) throw new Error(`Not a hyperspace option: ${String(option)}`);
    if (known.kind === 'switch') {
      if (typeof value !== 'boolean') throw new Error('Full screen must be on or off');
      this.current().setFullScreen(value);
    } else {
      if (value !== 'hide' && value !== 'keep') throw new Error(`${known.option} must be hide or keep`);
      this.current().choose(known.option, value);
    }
    return this.state();
  }

  save(): Promise<SaveResult> {
    return this.current().save();
  }
}
