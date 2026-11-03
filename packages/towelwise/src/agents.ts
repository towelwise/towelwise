// The agents Towelwise can place, and where each one's view or tab can live. The container ids and commands are the
// ones the agents' own manifests declare (checked 2026-11-03 against Claude Code 2.1.317 and Codex 26.1021).

export type AgentId = 'claudeCode' | 'codex';
export type Place = 'left' | 'right' | 'panel' | 'editor';

export const PLACES: readonly Place[] = ['left', 'right', 'panel', 'editor'];

export interface AgentInfo {
  label: string;
  // The view containers the agent contributes, most likely first: which exists depends on the VS Code version.
  containers: readonly string[];
  // The agent's own command that shows its side view, wherever that view now lives.
  openSidebar: string;
}

export const AGENTS: Record<AgentId, AgentInfo> = {
  claudeCode: {
    label: 'Claude Code',
    containers: ['claude-sidebar-secondary', 'claude-sidebar'],
    openSidebar: 'claude-vscode.sidebar.open',
  },
  codex: {
    label: 'Codex',
    containers: ['codexSecondaryViewContainer', 'codexViewContainer'],
    openSidebar: 'chatgpt.openSidebar',
  },
};

export const AGENT_IDS = Object.keys(AGENTS) as AgentId[];

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
