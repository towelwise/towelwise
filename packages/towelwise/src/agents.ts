// The agents Towelwise can place, and where each one's view or tab can live. The container ids and commands are the
// ones the agents' own manifests declare (checked 2026-11-03 against Claude Code 2.1.317 and Codex 26.1021).

export type AgentId = 'claudeCode' | 'codex';
// column: a column or cell of the editor grid the person designs (the grid comes with a later slice).
export type Place = 'left' | 'right' | 'panel' | 'column';

export const PLACES: readonly Place[] = ['left', 'right', 'panel', 'column'];

export interface AgentInfo {
  label: string;
  // The view containers the agent's manifest declares, most likely first: which exists depends on the VS Code version.
  containers: readonly string[];
  // The agent's own command that shows its side view, wherever that view now lives.
  openSidebar: string;
  // The command that opens the agent as an editor tab, and whether that tab lands in the focused group (Codex does;
  // Claude Code adds a group of its own, so its tab has to be moved).
  editor: { command: string; inFocusedGroup: boolean };
}

export const AGENTS: Record<AgentId, AgentInfo> = {
  claudeCode: {
    label: 'Claude Code',
    containers: ['claude-sidebar-secondary', 'claude-sidebar'],
    openSidebar: 'claude-vscode.sidebar.open',
    editor: { command: 'claude-vscode.editor.open', inFocusedGroup: false },
  },
  codex: {
    label: 'Codex',
    containers: ['codexSecondaryViewContainer', 'codexViewContainer'],
    openSidebar: 'chatgpt.openSidebar',
    editor: { command: 'chatgpt.newCodexPanel', inFocusedGroup: true },
  },
};

/** The id core gives a view container an extension declares: it prefixes the manifest's id (viewsExtensionPoint). */
export const coreContainerId = (manifestId: string) => `workbench.view.extension.${manifestId}`;

export const AGENT_IDS = Object.keys(AGENTS) as AgentId[];

/** What an editor-grid cell can hold: an agent or a terminal. */
export type Holds = AgentId | 'terminal';
export const HOLDS: readonly Holds[] = [...AGENT_IDS, 'terminal'];

/** A tab's input, reduced to what tells the agents apart (the view type is what the agent registers). */
export interface TabInputInfo {
  type: 'webview' | 'custom' | 'terminal' | 'other';
  viewType?: string;
}

/** What a tab is: Claude Code is a webview, Codex a custom editor, a terminal a terminal; anything else is not ours. */
export function holdsOfTab(input: TabInputInfo): Holds | undefined {
  if (input.type === 'terminal') return 'terminal';
  if (input.type === 'webview' && /claudeVSCodePanel$/.test(input.viewType ?? '')) return 'claudeCode';
  if (input.type === 'custom' && input.viewType === 'chatgpt.conversationEditor') return 'codex';
  return undefined;
}

export type AgentPlaces = Partial<Record<AgentId, Place>>;

/** The towelwise.layout.agents setting: nothing set gives undefined quietly; a value that does not fit is ignored as a whole and logged. */
export function parseAgents(raw: unknown, log: (line: string) => void): AgentPlaces | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    log('ignored layout.agents: not an object of agent places');
    return undefined;
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) return undefined;
  const places: AgentPlaces = {};
  for (const [id, place] of entries) {
    if (!AGENT_IDS.includes(id as AgentId) || !PLACES.includes(place as Place)) {
      log(`ignored layout.agents: "${id}" needs an agent (${AGENT_IDS.join(', ')}) and a place (${PLACES.join(', ')})`);
      return undefined;
    }
    places[id as AgentId] = place as Place;
  }
  return places;
}
