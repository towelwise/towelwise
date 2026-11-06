import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import * as vscode from 'vscode';
import { TerminalShell, shellsOn } from './cellTerminal';
import { LayoutDraft, LayoutEnv, SaveResult, parseLayoutMessage } from './layoutDraft';
import { liveEditors } from './liveEditors';
import { withLock } from './lock';
import { readRecoveryText } from './recoveryFile';
import { Editors, MyLayout } from './myLayout';
import { pageHtml } from './picker';
import { readSaved } from './savedLayout';
import { detectMachine } from './shells';
import { parseLayoutState } from './sizes';

// One page at a time. Its draft lives here, so hiding the page keeps it and closing the page drops it.
let current: { panel: vscode.WebviewPanel } | undefined;

const config = () => vscode.workspace.getConfiguration('towelwise.layout');

// The window's sizes through the core bridge, and the three layout settings in the user's settings.
const liveEnv: LayoutEnv = {
  read: async () => {
    try {
      return parseLayoutState(await vscode.commands.executeCommand('_towelwise.layout.state'));
    } catch {
      return undefined;
    }
  },
  write: saveLayoutSettings,
};

/** The slice of a settings section that writeAll and recoverSavedLayout use. */
export interface SettingsSection {
  inspect(key: string): { globalValue?: unknown } | undefined;
  update(key: string, value: unknown, target: vscode.ConfigurationTarget): PromiseLike<void>;
}

const KEYS = ['agents', 'grid', 'sizes'] as const;
type Values = { agents: unknown; grid: unknown; sizes: unknown };

/** Where the old layout settings are kept on disk while a save is writing the new ones. */
export const layoutRecordPath = (storageDir: string): string => path.join(storageDir, 'layout.saving.json');

// Settings go through JSON, so compare them as JSON does: a copy of each, with no regard for key order.
const jsonCopy = (v: unknown): unknown => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const same = (a: unknown, b: unknown): boolean => isDeepStrictEqual(jsonCopy(a), jsonCopy(b));

/**
 * Writes the layout settings one after another. The old values are written to `recordFile` first; if that fails, nothing
 * is changed. If a setting fails, the ones already written are put back (one the user had none of is removed) and the
 * record is removed. If some cannot be put back, the record stays, the error says so, and the next start puts them back
 * (recoverSavedLayout). The original failure always reaches the caller.
 */
export async function writeAll(section: SettingsSection, values: Values, recordFile?: string): Promise<void> {
  // A record still here is from an earlier save that could not be put right: its old values are the only copy. Settle it
  // first; if that fails, nothing is written, so the record is not replaced by one that starts from the half-saved mix.
  if (recordFile && fs.existsSync(recordFile)) await putBackFromRecord(recordFile, section);
  const before = KEYS.map((key) => section.inspect(key)?.globalValue);
  if (recordFile) {
    const old = Object.fromEntries(KEYS.map((key, i) => [key, before[i] === undefined ? { had: false } : { had: true, value: before[i] }]));
    fs.mkdirSync(path.dirname(recordFile), { recursive: true });
    fs.writeFileSync(recordFile, JSON.stringify({ before: old, after: values }));
  }
  const done: number[] = [];
  try {
    for (const [i, key] of KEYS.entries()) {
      await section.update(key, values[key], vscode.ConfigurationTarget.Global);
      done.push(i);
    }
  } catch (e) {
    const stuck: string[] = [];
    for (const i of done.reverse()) {
      try {
        await section.update(KEYS[i], before[i], vscode.ConfigurationTarget.Global);
      } catch {
        stuck.push(KEYS[i]);
      }
    }
    if (stuck.length === 0) {
      if (recordFile) fs.rmSync(recordFile, { force: true });
      throw e;
    }
    const why = e instanceof Error ? e.message : String(e);
    throw new Error(`${why}. These could not be put back and stay as they were just saved: ${stuck.join(', ')}. They will be put back the next time a window starts.`);
  }
  // A record left behind here only costs a look at the next start, which finds the save finished and drops it.
  if (recordFile) fs.rmSync(recordFile, { force: true });
}

type Entry = { had: boolean; value?: unknown };
// An old value that was there must be given; without it "no value" would be guessed, and the user's setting removed.
const isEntry = (e: unknown): e is Entry =>
  typeof e === 'object' && e !== null && typeof (e as Entry).had === 'boolean' && (!(e as Entry).had || 'value' in e);

/** The record, if it has the whole shape writeAll gives it. */
function readRecord(file: string): { before: Record<string, Entry>; after: Record<string, unknown> } | undefined {
  // A read that fails throws and keeps the record; only content that does not fit is dropped by the caller.
  const text = readRecoveryText(file);
  if (text === undefined) return undefined;
  let saved: unknown;
  try {
    saved = JSON.parse(text);
  } catch {
    return undefined;
  }
  const isObject = (o: unknown): o is Record<string, unknown> => typeof o === 'object' && o !== null && !Array.isArray(o);
  if (!isObject(saved) || !isObject(saved.before) || !isObject(saved.after)) return undefined;
  const { before, after } = saved;
  if (!KEYS.every((key) => isEntry(before[key]) && key in after)) return undefined;
  return { before: before as Record<string, Entry>, after };
}

/**
 * If a window died while saving the layout, puts back the settings it had already changed. Runs under the cross-window
 * lock, so a save that is still going in another window is left alone. A save that did finish is kept, and a setting the
 * user changed since is not overwritten. A record that is not whole is dropped without touching any setting.
 */
export async function recoverSavedLayout(storageDir: string, section: SettingsSection, log: (line: string) => void = () => undefined): Promise<boolean> {
  const file = layoutRecordPath(storageDir);
  if (!fs.existsSync(file)) return false;
  return withLock(storageDir, () => putBackFromRecord(file, section, log), false);
}

// The part of recovery that needs the lock already held: false if the record was not whole.
async function putBackFromRecord(file: string, section: SettingsSection, log: (line: string) => void = () => undefined): Promise<boolean> {
  const saved = readRecord(file);
  if (!saved) {
    fs.rmSync(file, { force: true });
    log('dropped a layout save record that could not be read');
    return false;
  }
  const now = KEYS.map((key) => section.inspect(key)?.globalValue);
  // Every setting carries its new value: the save finished, and only the record was left.
  if (!KEYS.every((key, i) => same(now[i], saved.after[key]))) {
    for (const [i, key] of KEYS.entries()) {
      const old = saved.before[key];
      const was = old.had ? old.value : undefined;
      if (same(now[i], saved.after[key]) && !same(now[i], was)) {
        await section.update(key, was, vscode.ConfigurationTarget.Global);
        log(`put ${key} back after a layout save was cut short`);
      }
    }
  }
  fs.rmSync(file, { force: true });
  return true;
}

let recordDir: string | undefined;

/** Says where the save's record is kept; call once at activation. */
export function keepLayoutRecordIn(storageDir: string | undefined): void {
  recordDir = storageDir;
}

// One save at a time across windows, and not while another window restores: recovery treats a record it finds as left over.
// A function is called under the lock, so it decides on the settings as they are when written; undefined writes nothing.
export async function saveLayoutSettings(values: Values | (() => Values | undefined)): Promise<void> {
  const dir = recordDir;
  const write = async (record?: string) => {
    // A save left half done is put right first, so the function never decides on its mix (writeAll would only do it after).
    if (record && fs.existsSync(record)) await putBackFromRecord(record, config());
    const now = typeof values === 'function' ? values() : values;
    if (now) await writeAll(config(), now, record);
  };
  if (!dir) return write();
  const saved = await withLock(dir, async () => (await write(layoutRecordPath(dir)), true), false);
  if (!saved) throw new Error('Another Towelwise window is busy with a layout. Try saving again in a moment.');
}

/** Runs the work while no layout can be saved or restored in any window (the lock saves use); false, without running it, if one is busy. */
export async function holdLayoutSaves(work: () => Promise<void>): Promise<boolean> {
  const dir = recordDir;
  if (!dir) return (await work(), true);
  return withLock(dir, async () => (await work(), true), false);
}

// True from the moment the page closes itself for a restore until the page is back. Nothing else opens a page
// meanwhile: the restore brings this draft back, and a second page would take its place and lose it.
let restoring = false;

// What the page needs from VS Code, so tests can stand in for the window.
export interface PageHost {
  createPanel(media: vscode.Uri): vscode.WebviewPanel;
  run(command: string): Thenable<unknown>;
  /** Runs work with empty groups held open and no restore or jump running in any window; false if one was. */
  holdEmptyGroups(work: () => Promise<void>): Promise<boolean>;
  wait(ms: number): Promise<void>;
  /** The shells this machine has, offered for terminal cells. */
  shells(): Promise<TerminalShell[]>;
}

/**
 * The empty-groups hold is a global user setting, so it is only taken under the lock restore and hyperspace use:
 * another window's restore cannot have the setting put back under it, and this hold cannot start in the middle of one.
 */
export function lockedHold(storageDir: string, editors: Pick<Editors, 'keepEmptyGroups'>): PageHost['holdEmptyGroups'] {
  return async (work) => {
    let ran = false;
    await withLock<void>(
      storageDir,
      () =>
        editors.keepEmptyGroups(async () => {
          ran = true;
          await work();
        }),
      undefined,
    );
    return ran;
  };
}

const liveHostFor = (storageDir: string): PageHost => ({
  createPanel: (media) =>
    vscode.window.createWebviewPanel('towelwise.layout.choose', 'Choose Layout', vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [media],
    }),
  run: (command) => vscode.commands.executeCommand(command),
  holdEmptyGroups: lockedHold(storageDir, liveEditors),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  shells: async () => shellsOn(await detectMachine()),
});

/** Whether the page is open or a restore it started is running: the drift prompt keeps out of the way then. */
export const isLayoutPageBusy = (): boolean => current !== undefined || restoring;

/** Opens the page on a layout other than the saved one, such as the window as it is now. */
export function openLayoutPageFrom(context: vscode.ExtensionContext, log: (line: string) => void, layout: MyLayout): void {
  openLayoutPage(context, log, new LayoutDraft(layout, liveEnv));
}

/** Closes the page if it is open (the tests use this to leave no window behind). */
export function closeLayoutPage(): void {
  current?.panel.dispose();
}

// `kept` is a draft carried over from a page that closed itself for a restore (see 'restore' below).
export function openLayoutPage(
  context: vscode.ExtensionContext,
  log: (line: string) => void,
  kept?: LayoutDraft,
  host: PageHost = liveHostFor(context.globalStorageUri.fsPath),
): void {
  if (restoring) return;
  if (current) {
    current.panel.reveal();
    return;
  }

  const media = vscode.Uri.joinPath(context.extensionUri, 'media');
  const panel = host.createPanel(media);
  current = { panel };
  let closed = false;
  const draft = kept ?? new LayoutDraft(readSaved(log), liveEnv);
  const uri = (file: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(media, file)).toString();
  panel.webview.html = pageHtml({
    cspSource: panel.webview.cspSource,
    nonce: randomBytes(16).toString('hex'),
    scriptUri: uri('layout.js'),
    styleUri: uri('layout.css'),
    title: 'Choose Layout',
  });

  // The page opens as a tab in the active group, then moves to its own window so it does not sit among
  // (or split) the editor groups the layout is about. If the move fails, the page stays where it is. The page
  // may be the only tab in an empty group, and VS Code closes a group when its last tab leaves, which would
  // remove a column the person set up; empty groups are held open for the move. The hold can take a moment, and
  // the command moves whichever editor is active when it runs, so the move is dropped if the page has closed
  // meanwhile, and the page is made the active editor first. If a restore or jump is running elsewhere, the page
  // stays where it opened rather than race it.
  void host
    .holdEmptyGroups(async () => {
      if (closed) return;
      panel.reveal(undefined, false);
      await host.run('workbench.action.moveEditorToNewWindow');
    })
    .then(
      (held) => {
        if (!held) log('Choose Layout stayed in this window: a restore or jump is running.');
      },
      (e: unknown) => log(`Choose Layout could not move to its own window: ${e instanceof Error ? e.message : String(e)}`),
    );

  // A Save result is shown until the person changes something; any other update clears it.
  const send = (extra: { result?: SaveResult } = {}) =>
    panel.webview.postMessage({ type: 'state', ...draft.view(), clearResult: !extra.result, ...extra });

  // Finding the shells can take a moment (WSL is asked for its distributions), so the page is drawn first and
  // offers them once they are known.
  host.shells().then(
    (shells) => {
      draft.setShells(shells);
      if (!closed) void send();
    },
    (e: unknown) => log(`Choose Layout could not find this machine's shells: ${e instanceof Error ? e.message : String(e)}`),
  );

  panel.webview.onDidReceiveMessage(
    async (raw: unknown) => {
      const message = parseLayoutMessage(raw);
      if (!message) return;
      try {
        switch (message.type) {
          case 'ready':
            await send();
            return;
          case 'place':
            draft.setPlace(message.agent, message.place === '' ? undefined : message.place);
            break;
          case 'useColumns':
            draft.useColumns();
            break;
          case 'removeColumns':
            draft.removeColumns();
            break;
          case 'startOver':
            draft.startOver();
            break;
          case 'addColumn':
            draft.addColumn(message.side);
            break;
          case 'removeColumn':
            draft.removeColumn(message.index);
            break;
          case 'addRow':
            draft.addRow(message.column, message.row);
            break;
          case 'removeRow':
            draft.removeRow(message.column, message.row);
            break;
          case 'drag':
            draft.dragEdge(message.axis, message.column, message.axis === 'row' ? message.row : undefined, message.size);
            break;
          case 'assign':
            draft.assign(message.column, message.row, message.holds === '' ? undefined : message.holds);
            break;
          case 'terminal':
            draft.setTerminal(message.column, message.row, message.terminal);
            break;
          case 'size':
            await draft.setSize(message.part, message.value);
            break;
          case 'useCurrentSizes':
            await draft.useCurrentSizes();
            break;
          case 'save': {
            // A save that throws is shown on the page like a refusal, so the result unlocks the page's fields.
            const result = await draft.save().catch((e: unknown): SaveResult => ({ ok: false, problem: e instanceof Error ? e.message : String(e) }));
            // Closed while it saved (Cancel or its tab): the write stands, but a reload now could discard another page's draft.
            if (closed) return;
            // A refusal, or a change made while it saved, stays on the page to be read; a reload would lose it.
            if (!result.ok || result.stale) {
              await send({ result });
              return;
            }
            panel.dispose();
            await host.run('workbench.action.reloadWindow');
            return;
          }
          case 'restore':
            // Restore moves focus between editor groups, which acts on the window that has focus. From this
            // page's own window it would rearrange the page, so the page closes first, the restore runs in
            // the main window, and the page comes back with the same unsaved draft.
            restoring = true;
            panel.dispose();
            try {
              await host.wait(300); // let focus return to the main window
              await host.run('towelwise.layout.restore');
            } finally {
              restoring = false;
              openLayoutPage(context, log, draft, host);
            }
            return;
          case 'reload':
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
            return;
          case 'cancel':
            panel.dispose();
            return;
        }
        await send();
      } catch (e) {
        void vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));
      }
    },
    undefined,
    context.subscriptions,
  );
  panel.onDidDispose(
    () => {
      closed = true;
      if (current?.panel === panel) current = undefined;
    },
    undefined,
    context.subscriptions,
  );
}
