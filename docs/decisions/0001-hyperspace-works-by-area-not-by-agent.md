# Hyperspace works by layout area, not by agent

Hyperspace hides chrome and closes side areas that the person chooses in settings. It does not detect which AI extensions are installed or where their panels sit, so it works with any agent, including ones Towelwise has no knowledge of.

**Ruled out:** an agent-aware hyperspace that finds Claude Code, Codex and Copilot and keeps only their areas. It would depend on each vendor's internal view ids, break when a vendor renames them, and leave out agents such as Antigravity whose terms have not been checked (roadmap: vendor rules first). It also gains nothing for someone who has already arranged their agents.

**Consequence:** the person says what to keep, through settings, and Towelwise never needs to learn about agents in this slice.
