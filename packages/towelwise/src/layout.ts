import * as vscode from 'vscode';
import { isActive } from './hyperspace';

// VS Code cannot read or move the layout, so a layout is declared: the containers to show, in order.
// Showing a container opens it where it already lives; nothing is moved or closed.
const BUILT_IN_CHAT = 'workbench.panel.chat';
const CHAT_OPEN = 'workbench.action.chat.open';

// What applying a layout needs from VS Code, so tests can stand in for it.
interface LayoutEnv {
  run(command: string): PromiseLike<unknown>;
  available: ReadonlySet<string>;
  views: ReadonlyMap<string, string>; // container id -> its first view id
}

// A view's own focus command always reveals it. The container command toggles when the container is in the
// bottom panel, so it is only the fallback for a container whose view is unknown.
function showCommand(id: string, vs: LayoutEnv): string | undefined {
  if (id === BUILT_IN_CHAT) return vs.available.has(CHAT_OPEN) ? CHAT_OPEN : undefined;
  const focus = vs.views.has(id) ? `${vs.views.get(id)}.focus` : undefined;
  if (focus && vs.available.has(focus)) return focus;
  const container = `workbench.view.extension.${id}`;
  return vs.available.has(container) ? container : undefined;
}

const layoutConfig = () => vscode.workspace.getConfiguration('towelwise.layout');
// A hand-edited setting may hold anything: a non-list counts as empty, and only strings in a list can be ids.
const savedList = (key: string): string[] => {
  const value = layoutConfig().get<unknown>(key);
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
};

interface Manifest {
  contributes?: {
    viewsContainers?: Record<string, { id: string }[]>;
    views?: Record<string, { id?: string }[]>;
  };
}

/**
 * Each container's first view. Other extensions can contribute views to someone else's container, and theirs may
 * be inactive, so the view from the extension that declares the container wins; another extension's view is only a
 * fallback for an owner that contributes none.
 */
export function viewsByContainer(manifests: Manifest[]): Map<string, string> {
  const owned = new Map<string, string>();
  const others = new Map<string, string>();
  for (const m of manifests) {
    const declared = new Set(Object.values(m?.contributes?.viewsContainers ?? {}).flatMap((list) => list.map((c) => c.id)));
    for (const [container, list] of Object.entries(m?.contributes?.views ?? {})) {
      const first = list[0]?.id;
      const target = declared.has(container) ? owned : others;
      if (first && !target.has(container)) target.set(container, first);
    }
  }
  return new Map([...others, ...owned]);
}

export async function liveVsCode(): Promise<LayoutEnv> {
  return {
    run: (command) => vscode.commands.executeCommand(command),
    available: new Set(await vscode.commands.getCommands(true)),
    views: viewsByContainer(vscode.extensions.all.map((ext) => ext.packageJSON)),
  };
}

/**
 * Runs the show command for each saved container, in order, then (unless asked not to) each saved layout command,
 * such as an agent's own "open chat". Anything with no command is skipped and reported. "Ran" is not "visible":
 * VS Code cannot say which of an extension's containers is currently enabled, or whether a tab is already open.
 */
export async function restoreLayout(vs: LayoutEnv, withCommands = true): Promise<{ ran: string[]; skipped: string[] }> {
  const ran: string[] = [];
  const skipped: string[] = [];
  for (const id of savedList('containers')) {
    const command = showCommand(id, vs);
    if (command) {
      await vs.run(command);
      ran.push(id);
    } else {
      skipped.push(id);
    }
  }
  for (const command of withCommands ? savedList('commands') : []) {
    if (vs.available.has(command)) {
      await vs.run(command);
      ran.push(command);
    } else {
      skipped.push(command);
    }
  }
  return { ran, skipped };
}

/** Applies the layout when a window opens, if the person opted in and hyperspace is not on. */
export async function applyOnStartup(storageDir: string, env: () => Promise<LayoutEnv>): Promise<boolean> {
  // The environment is built only when needed: it reads every command and extension manifest, on every window open.
  if (!layoutConfig().get('applyOnStartup', false) || isActive(storageDir)) return false;
  const vs = await env();
  // Another window may have started hyperspace while the environment loaded.
  if (isActive(storageDir)) return false;
  // Containers only: a layout command may open a new tab, and VS Code has usually restored the open ones already.
  await restoreLayout(vs, false);
  return true;
}

export interface Choice {
  id: string;
  label: string;
  description: string;
}

function discoverContainers(vs: LayoutEnv): Choice[] {
  const found: Choice[] = [];
  for (const ext of vscode.extensions.all) {
    const containers = ext.packageJSON?.contributes?.viewsContainers ?? {};
    for (const [area, name] of [
      ['activitybar', 'Side bar'],
      ['secondarySidebar', 'Secondary side bar'],
    ]) {
      for (const c of containers[area] ?? []) {
        if (!showCommand(c.id, vs)) continue;
        // An untranslated "%key%" title is no use to a person; fall back to the id.
        const label = typeof c.title === 'string' && !c.title.startsWith('%') ? c.title : c.id;
        found.push({ id: c.id, label, description: `${name} · ${c.id}` });
      }
    }
  }
  if (showCommand(BUILT_IN_CHAT, vs)) {
    found.push({ id: BUILT_IN_CHAT, label: 'Chat', description: 'Built in' });
  }
  return found;
}

// Saved containers first, in saved order, so a layout keeps its order; ones no longer installed stay so they can be unticked.
export function orderChoices(saved: string[], found: Choice[]): Choice[] {
  return [
    ...saved.map((id) => found.find((c) => c.id === id) ?? { id, label: id, description: 'Not installed' }),
    ...found.filter((c) => !saved.includes(c.id)),
  ];
}

/** Lets the person pick the containers for the layout. Resolves false if they cancel. */
export async function chooseLayout(): Promise<boolean> {
  const saved = savedList('containers');
  const found = discoverContainers(await liveVsCode());
  const choices = orderChoices(saved, found);
  const picked = await vscode.window.showQuickPick(
    choices.map((c) => ({ ...c, picked: saved.includes(c.id) })),
    { canPickMany: true, title: 'Towelwise: Choose Layout', placeHolder: 'Pick the agent panels to show when you restore your layout' },
  );
  if (!picked) return false;
  await layoutConfig().update('containers', picked.map((c) => c.id), vscode.ConfigurationTarget.Global);
  return true;
}
