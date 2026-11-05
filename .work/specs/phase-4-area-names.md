# Phase 4, slice 1b: Area names in the layout picker

Status: ready-for-agent (scope agreed with the owner, 2026-11-03: active container only; no flash on the live window in this slice).

## Goal

In the Edit Hyperspace Layout picker, each of the three resizable areas says what is open in it right now, so the person can tell which box is which: "Primary side bar · Explorer", "Secondary side bar · Claude Code", "Bottom panel · Terminal". Only the active container is named, which is what the person sees there now. Terms follow [GLOSSARY.md](../../GLOSSARY.md). Follows [the sizes spec](phase-4-sizes.md) and [0005](../../docs/decisions/0005-patch-core-only-when-the-extension-cannot.md): the bridge only reports, and the extension decides what to show.

## Approved decisions (owner, 2026-11-03)

- Name the active container only, not everything open in the area.
- A brief flash on the live window is out of this slice. It is reconsidered only if the names are not enough (the 2026-11-02 spike dropped boxes drawn over the live window).
- Claude Code chats that live in the editor area, and editor-group layouts, belong to the editor-grid slice (5a), not here.

## Acceptance criteria

1. **Bridge.** `_towelwise.layout.state` adds, to each of the three parts, an optional `container: { id, title }` for the active container in that area: the id of the active pane composite and the title of its view container. It is absent if the part is not visible, has no active container, or the title cannot be found. The rest of the reply is unchanged. Patch 0003 is amended in place (it is not yet released), and its README note says so.
2. **Extension.** `parseLayoutState` accepts the optional container (a non-empty string id and title) and drops one that does not fit without rejecting the whole state. An older bridge without containers still works.
3. **Picker.** Each of the three area buttons in the mock window shows its container title after the area name, when known. An area that is not open or has no name shows its plain name, as today. The accessible label includes the title. Without the bridge, nothing changes.
4. **Fresh names.** Names are read when the page loads, when the panel becomes visible again, and after Use current sizes, so they follow what the person has open. A failed read keeps the previous names and never blocks Keep or Hide or Save.
5. Names are display only: nothing is saved, no setting changes, and the hyperspace behaviour is unchanged. Root `npm run lint`, `npm run build`, `npm test` and `npm run package` exit 0, and the full IDE build succeeds.

## Verification

- Tests (extension host): parsing the state with and without containers, and with a malformed container (dropped, state kept); the draft's view of names from a stand-in bridge, including a changed name after a refresh, a failed refresh keeping the old name, and no bridge; the page message flow does not change what Save writes.
- Built app, by the owner: open the picker with Explorer, a secondary side bar view and the Terminal showing, and see their names on the three area buttons; switch the side bar to Search, reopen or refocus the picker, and see the name change; close the panel and see its plain name.

## Out of scope

- Naming everything open in an area, the editor area's contents, or editor groups (5a).
- A flash or highlight on the live window.
- Changing which area a container lives in.
