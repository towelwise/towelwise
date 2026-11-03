// Sizes of the three resizable parts, as proportions of the window so they carry across screens.
// Pure logic only: reading and setting real sizes goes through the core bridge commands.
export type PartName = 'sidebar' | 'auxiliarybar' | 'panel';
export type PanelPosition = 'left' | 'right' | 'top' | 'bottom';
// Across: the panel sits left or right, so its width is sized. Down: top or bottom, so its height.
export type Orientation = 'across' | 'down';

export const PARTS: readonly PartName[] = ['sidebar', 'auxiliarybar', 'panel'];

/** What the bridge reports for the window it was called from. */
export interface LayoutState {
  window: { width: number; height: number };
  panelPosition: PanelPosition;
  // container is the active container in that area, when the bridge can name it.
  parts: Record<PartName, { visible: boolean; size: number; container?: { id: string; title: string } }>;
}

/** The towelwise.hyperspace.sizes setting: proportions from 0 to 1, any may be absent. */
export interface Sizes {
  sidebar?: number;
  auxiliarybar?: number;
  panel?: number;
  panelOrientation?: Orientation;
}

export const MIN_PERCENT = 5;
export const MAX_PERCENT = 80;
export const MIN_EDITOR_PERCENT = 20;

export const orientationOf = (position: PanelPosition): Orientation =>
  position === 'left' || position === 'right' ? 'across' : 'down';

// The window dimension a part's size is measured against.
const extent = (part: PartName, state: LayoutState): number =>
  part === 'panel' && orientationOf(state.panelPosition) === 'down' ? state.window.height : state.window.width;

/** The visible parts' current sizes as proportions of the window. */
export function toProportions(state: LayoutState): Sizes {
  const sizes: Sizes = {};
  for (const part of PARTS) {
    const { visible, size } = state.parts[part];
    if (!visible) continue;
    sizes[part] = size / extent(part, state);
    if (part === 'panel') sizes.panelOrientation = orientationOf(state.panelPosition);
  }
  return sizes;
}

/** Sizes to set for a jump: the parts to size, and the panel if its orientation no longer matches (the person is told). */
export function planSizes(
  saved: Sizes,
  state: LayoutState,
  kept: ReadonlySet<PartName>,
): { set: { part: PartName; pixels: number }[]; skipped: PartName[] } {
  const set: { part: PartName; pixels: number }[] = [];
  const skipped: PartName[] = [];
  for (const part of PARTS) {
    const proportion = saved[part];
    if (proportion === undefined || !kept.has(part) || !state.parts[part].visible) continue;
    if (part === 'panel' && saved.panelOrientation !== orientationOf(state.panelPosition)) {
      skipped.push(part);
      continue;
    }
    set.push({ part, pixels: Math.round(proportion * extent(part, state)) });
  }
  return { set, skipped };
}

const isProportion = (v: unknown): v is number => typeof v === 'number' && v > 0 && v <= 1;

/** A hand-edited setting may hold anything: parts that do not fit are ignored one by one and logged. */
export function parseSizes(raw: unknown, log: (line: string) => void): Sizes {
  const sizes: Sizes = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return sizes;
  const value = raw as Record<string, unknown>;
  for (const part of ['sidebar', 'auxiliarybar'] as const) {
    if (value[part] === undefined) continue;
    if (isProportion(value[part])) sizes[part] = value[part];
    else log(`ignored sizes.${part}: not a proportion above 0 and up to 1`);
  }
  if (value.panel !== undefined) {
    if (isProportion(value.panel) && (value.panelOrientation === 'across' || value.panelOrientation === 'down')) {
      sizes.panel = value.panel;
      sizes.panelOrientation = value.panelOrientation;
    } else log('ignored sizes.panel: needs a proportion above 0 and up to 1, and an orientation of across or down');
  }
  return sizes;
}

/**
 * Checks percentages (0 to 100) before Save. Only typed values are range checked; a captured value is saved as read.
 * The editor floor applies only when a side-bar width was typed. Returns a message, or undefined if fine.
 */
export function validateTyped(
  percents: Partial<Record<PartName, number | undefined>>,
  typed: ReadonlySet<PartName>,
): string | undefined {
  for (const part of PARTS) {
    const p = percents[part];
    if (!typed.has(part) || p === undefined) continue;
    if (!Number.isFinite(p) || p < MIN_PERCENT || p > MAX_PERCENT) {
      return `Sizes must be numbers between ${MIN_PERCENT} and ${MAX_PERCENT} percent.`;
    }
  }
  if (typed.has('sidebar') || typed.has('auxiliarybar')) {
    const bars = (percents.sidebar ?? 0) + (percents.auxiliarybar ?? 0);
    if (bars > 100 - MIN_EDITOR_PERCENT) {
      return `The two side bars together must leave at least ${MIN_EDITOR_PERCENT} percent of the width for the editor.`;
    }
  }
  return undefined;
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The bridge's answer, checked: a missing or older bridge, or a changed shape, never reaches the size logic. */
export function parseLayoutState(raw: unknown): LayoutState | undefined {
  const s = raw as Partial<LayoutState> | null | undefined;
  if (!s || typeof s !== 'object' || !s.window || !s.parts) return undefined;
  if (!isNumber(s.window.width) || !isNumber(s.window.height) || s.window.width <= 0 || s.window.height <= 0) return undefined;
  if (!(['left', 'right', 'top', 'bottom'] as unknown[]).includes(s.panelPosition)) return undefined;
  for (const part of PARTS) {
    const p = s.parts[part];
    if (!p || typeof p.visible !== 'boolean' || !isNumber(p.size)) return undefined;
    // A container that does not fit is dropped; the rest of the state is still good.
    const c = p.container as { id?: unknown; title?: unknown } | undefined;
    if (c !== undefined && !(typeof c?.id === 'string' && c.id !== '' && typeof c.title === 'string' && c.title !== '')) {
      delete p.container;
    }
  }
  return s as LayoutState;
}

/** The pixel sizes a jump found, kept so leaving can put them back. */
export interface Recorded {
  pixels: Partial<Record<PartName, number>>;
  panelOrientation?: Orientation;
}

export function record(state: LayoutState): Recorded {
  const pixels: Recorded['pixels'] = {};
  for (const part of PARTS) if (state.parts[part].visible) pixels[part] = state.parts[part].size;
  return { pixels, panelOrientation: orientationOf(state.panelPosition) };
}

/** A recorded value from a snapshot file, or undefined if it does not fit (sizes are then skipped). */
export function parseRecorded(raw: unknown): Recorded | undefined {
  const r = raw as Partial<Recorded> | null | undefined;
  if (!r || typeof r !== 'object' || !r.pixels || typeof r.pixels !== 'object') return undefined;
  const pixels: Recorded['pixels'] = {};
  for (const part of PARTS) {
    const v = (r.pixels as Record<string, unknown>)[part];
    if (v === undefined) continue;
    if (!isNumber(v) || v <= 0) return undefined;
    pixels[part] = v;
  }
  if (r.panelOrientation !== undefined && r.panelOrientation !== 'across' && r.panelOrientation !== 'down') return undefined;
  return { pixels, panelOrientation: r.panelOrientation };
}

/** Sizes to put back: recorded parts that are still visible, and the panel only if it has not turned. */
export function planRestore(
  recorded: Recorded,
  state: LayoutState,
): { set: { part: PartName; pixels: number }[]; skipped: PartName[] } {
  const set: { part: PartName; pixels: number }[] = [];
  const skipped: PartName[] = [];
  for (const part of PARTS) {
    const pixels = recorded.pixels[part];
    if (pixels === undefined || !state.parts[part].visible) continue;
    if (part === 'panel' && recorded.panelOrientation !== orientationOf(state.panelPosition)) {
      skipped.push(part);
      continue;
    }
    set.push({ part, pixels: Math.round(pixels) });
  }
  return { set, skipped };
}
