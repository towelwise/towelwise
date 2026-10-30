# Phase 2 slice 3: First-run walkthrough

Status: ready-for-agent

## Goal

Third slice of ROADMAP.md Phase 2, reshaped on 2026-10-30 from "beginner profile" to a first-run walkthrough; the quiet profile moves to its own later slice (roadmap slice 5). Someone who installs Towelwise sees a short guided start that shows what it does with the agents they already use: arrange them, choose a layout, restore it, try hyperspace.

Towelwise is a productivity and focus tool on top of agents the person has already chosen. It does not recommend or install agents, so the walkthrough names none ([decision 0001](../../docs/decisions/0001-hyperspace-works-by-area-not-by-agent.md): vendor-neutral). VS Code shows an extension's walkthrough once after install; it stays under Help > Welcome afterwards.

## Acceptance criteria

1. The extension contributes one walkthrough, titled for Towelwise, that appears in VS Code's Welcome page and in **Help > Welcome**. Towelwise adds no code to open it automatically.
2. The walkthrough has six steps, in this order:
   1. **Your agents.** Says Towelwise works alongside any AI coding agent. For someone with no agent yet, a button opens the Extensions view so they can choose one themselves.
   2. **Arrange your agents.** Text only: drag each agent's panel to the side you want.
   3. **Choose your layout.** Button runs **Towelwise: Choose Layout**.
   4. **Bring it back anytime.** Button runs **Towelwise: Restore Layout**, and names its key, `Ctrl+Alt+L`.
   5. **Jump to hyperspace.** Button runs **Towelwise: Jump to Hyperspace**, and names its key, `Ctrl+Alt+H`.
   6. **Make it yours.** Button opens Settings filtered to Towelwise, and mentions full screen, startup apply and what hyperspace hides.
3. Steps 3 to 5 tick as complete when their command runs. Steps 1, 2 and 6 complete when the person views them.
4. The walkthrough names no specific agent, recommends none, and never installs anything or runs an agent.
5. Root `npm run lint`, `npm run build`, `npm test` and `npm run package` exit 0, and CI passes on the PR.

## Approved decisions (user, 2026-10-30, grilling session)

- Audience: newcomers who already have their agents. If no agent is present, the walkthrough says Towelwise works with multiple AI agents and lets the person go to the Extensions view to choose; Towelwise does not choose for them.
- The quiet profile is deferred: VS Code has no extension API to create a profile.
- The walkthrough appears the way VS Code shows any extension walkthrough, once after install, with no extra Towelwise code.
- The six steps above.
- Test seam: a check of the contributed walkthrough manifest.

No decision record: deferring the profile is easy to reverse. This also answers the roadmap's open question "Which agents first?" for this slice: none are named.

## Verification

- **Automated (approved seam):** an extension test reads the walkthrough from the installed extension's manifest and asserts: exactly one walkthrough with six steps in the order above; every command a step's button runs is a registered command; every completion event names a registered Towelwise command; every referenced media or description file exists in the package. Use `tdd`.
- **Smoke checks:** lint, build and package exit 0 locally and in CI on the PR; the VSIX contains any new files.
- **Manual (wording and appearance are not automated):** install the VSIX, reload, open **Help > Welcome > Get Started with Towelwise**, read all six steps, click each button, and confirm steps 3 to 5 tick when run.

## Implementer defaults (approved by the user, 2026-10-30, as written in `e7cccfc`)

- The walkthrough id, title and step wording.
- Whether steps use plain text or images. Built as plain text, but VS Code requires every step to have `media`, so all six steps share one short markdown file, `packages/towelwise/media/walkthrough.md` (not "no new files" as first assumed).
- The exact commands behind the "open Extensions" and "open Settings" buttons, and the exact completion events.

## Out of scope

- The quiet profile (roadmap slice 5) and anything about creating VS Code profiles.
- Choosing, recommending, listing or installing agents.
- Opening the walkthrough automatically, or any Towelwise welcome UI of its own.
- Changing hyperspace or layout behaviour.

## Unresolved / external prerequisites

- Walkthrough behaviour on macOS and at the VS Code 1.90 floor is unchecked.
- Whether VS Code shows the walkthrough on every install or only a first one on that machine is VS Code's own behaviour and is not tested.
