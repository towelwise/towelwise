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
  log(line: string): void;
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

export async function liveVsCode(log: (line: string) => void = () => undefined): Promise<LayoutEnv> {
  return {
    log,
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
  vs.log(withCommands ? 'restore layout' : 'restore layout (containers only, on startup)');

  // Everything it runs or skips goes to the log, since VS Code cannot say whether a command had any visible effect.
  const run = async (command: string, note = '') => {
    try {
      await vs.run(command);
    } catch (e) {
      vs.log(`FAILED ${command}: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
    vs.log(`ran ${command}${note}`);
  };

  for (const id of savedList('containers')) {
    const command = showCommand(id, vs);
    if (command) {
      await run(command, ` (container ${id})`);
      ran.push(id);
    } else {
      vs.log(`skipped ${id}: no such command`);
      skipped.push(id);
    }
  }
  for (const command of withCommands ? savedList('commands') : []) {
    if (vs.available.has(command)) {
      await run(command);
      ran.push(command);
    } else {
      vs.log(`skipped ${command}: no such command`);
      skipped.push(command);
    }
  }
  return { ran, skipped };
}

/**
 * Applies the older container list when a window opens, if the person has not turned that off and hyperspace is not on.
 * A layout saved with Choose Layout is applied by applyLayoutOnStartup instead.
 */
export async function applyOnStartup(storageDir: string, env: () => Promise<LayoutEnv>): Promise<boolean> {
  // The environment is built only when needed: it reads every command and extension manifest, on every window open.
  if (!layoutConfig().get('applyOnStartup', true) || isActive(storageDir)) return false;
  const vs = await env();
  // Another window may have started hyperspace while the environment loaded.
  if (isActive(storageDir)) return false;
  // Containers only: a layout command may open a new tab, and VS Code has usually restored the open ones already.
  await restoreLayout(vs, false);
  return true;
}
