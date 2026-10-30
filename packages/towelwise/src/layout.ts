import * as vscode from 'vscode';
import { isActive } from './hyperspace';

// VS Code cannot read or move the layout, so a layout is declared: the containers to show, in order.
// Showing a container opens it where it already lives; nothing is moved or closed.
const BUILT_IN_CHAT = 'workbench.panel.chat';

// What applying a layout needs from VS Code, so tests can stand in for it.
interface LayoutEnv {
  run(command: string): PromiseLike<unknown>;
  available: ReadonlySet<string>;
}

const showCommand = (id: string) =>
  id === BUILT_IN_CHAT ? 'workbench.action.chat.open' : `workbench.view.extension.${id}`;

const layoutConfig = () => vscode.workspace.getConfiguration('towelwise.layout');
const savedContainers = () => layoutConfig().get<string[]>('containers', []);

export async function liveVsCode(): Promise<LayoutEnv> {
  return {
    run: (command) => vscode.commands.executeCommand(command),
    available: new Set(await vscode.commands.getCommands(true)),
  };
}

/** Shows each saved container in order. A container whose command does not exist is skipped and reported. */
export async function restoreLayout(vs: LayoutEnv): Promise<{ shown: string[]; skipped: string[] }> {
  const shown: string[] = [];
  const skipped: string[] = [];
  for (const id of savedContainers()) {
    if (vs.available.has(showCommand(id))) {
      await vs.run(showCommand(id));
      shown.push(id);
    } else {
      skipped.push(id);
    }
  }
  return { shown, skipped };
}

/** Applies the layout when a window opens, if the person opted in and hyperspace is not on. */
export async function applyOnStartup(storageDir: string, vs: LayoutEnv): Promise<boolean> {
  if (!layoutConfig().get('applyOnStartup', false) || isActive(storageDir)) return false;
  await restoreLayout(vs);
  return true;
}

interface Choice {
  id: string;
  label: string;
  description: string;
}

function discoverContainers(available: ReadonlySet<string>): Choice[] {
  const found: Choice[] = [];
  for (const ext of vscode.extensions.all) {
    const containers = ext.packageJSON?.contributes?.viewsContainers ?? {};
    for (const [area, name] of [
      ['activitybar', 'Side bar'],
      ['secondarySidebar', 'Secondary side bar'],
    ]) {
      for (const c of containers[area] ?? []) {
        if (!available.has(showCommand(c.id))) continue;
        // An untranslated "%key%" title is no use to a person; fall back to the id.
        const label = typeof c.title === 'string' && !c.title.startsWith('%') ? c.title : c.id;
        found.push({ id: c.id, label, description: `${name} · ${c.id}` });
      }
    }
  }
  if (available.has(showCommand(BUILT_IN_CHAT))) {
    found.push({ id: BUILT_IN_CHAT, label: 'Chat', description: 'Built in' });
  }
  return found;
}

/** Lets the person pick the containers for the layout. Resolves false if they cancel. */
export async function chooseLayout(): Promise<boolean> {
  const saved = savedContainers();
  const found = discoverContainers((await liveVsCode()).available);
  // Saved containers first, in saved order, so a layout keeps its order; ones no longer installed stay so they can be unticked.
  const choices: Choice[] = [
    ...saved.map((id) => found.find((c) => c.id === id) ?? { id, label: id, description: 'Not installed' }),
    ...found.filter((c) => !saved.includes(c.id)),
  ];
  const picked = await vscode.window.showQuickPick(
    choices.map((c) => ({ ...c, picked: saved.includes(c.id) })),
    { canPickMany: true, title: 'Towelwise: Choose Layout', placeHolder: 'Pick the agent panels to show when you restore your layout' },
  );
  if (!picked) return false;
  await layoutConfig().update('containers', picked.map((c) => c.id), vscode.ConfigurationTarget.Global);
  return true;
}
