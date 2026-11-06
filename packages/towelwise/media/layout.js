// The page only draws what the extension sends and reports clicks and drags. It never decides what is allowed.
const vscodeApi = acquireVsCodeApi();
const app = document.getElementById('app');

const PLACES = [
  ['', 'Not used', 'none'],
  ['left', 'Left side bar', 'left'],
  ['right', 'Right side bar', 'right'],
  ['panel', 'Bottom panel', 'panel'],
  ['column', 'A column', 'column'],
];

const send = (message) => vscodeApi.postMessage(message);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, onClick, className, key) {
  const b = el('button', className || '', label);
  b.type = 'button';
  if (key) b.dataset.key = key;
  b.addEventListener('click', onClick);
  return b;
}

// The last Save result stays on screen across redraws until the next Save.
let lastResult;

// While Save runs only Cancel works: a field reports its text when it loses focus, so text typed now could miss the
// save and be lost when the page reloads. Any Save result (which every outcome but closing sends) unlocks the page.
let saving = false;
const lockForSave = () => {
  if (saving) for (const node of app.querySelectorAll('[data-key]')) if (node.dataset.key !== 'cancel') node.disabled = true;
};
// The edge drag in progress, if any; Save (pressed from the keyboard) ends it first so its size is saved too.
let endDrag;
const save = () => {
  endDrag?.();
  saving = true;
  lockForSave();
  send({ type: 'save' });
};

function agentsSection(state) {
  const section = el('section');
  section.append(
    el('h2', '', '1. Where does each agent live?'),
    el('p', 'hint', 'Pick a place for each agent you use. A column is a cell in the editor area that you build below.'),
  );
  for (const agent of state.agents) {
    const row = el('div', 'agent');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', agent.label);
    row.append(el('span', 'name', agent.label));
    for (const [value, label, glyph] of PLACES) {
      const b = el('button', 'place');
      b.type = 'button';
      b.dataset.key = `place-${agent.id}-${value}`;
      b.setAttribute('aria-pressed', String(agent.place === value));
      b.append(el('span', `glyph ${glyph}`), document.createTextNode(label));
      b.addEventListener('click', () => send({ type: 'place', agent: agent.id, place: value }));
      row.append(b);
    }
    section.append(row);
  }
  return section;
}

// Dragging an edge: the neighbours resize as the pointer moves, and the new size is sent when it is let go.
function dragEdge(event, handle, axis, items, at, message) {
  event.preventDefault();
  // Locked like the fields while Save runs: a size sent only on release could miss the save.
  if (saving) return;
  const container = handle.parentElement;
  const rect = container.getBoundingClientRect();
  const sizes = items.map((i) => i.size);
  const before = sizes.slice(0, at).reduce((a, b) => a + b, 0);
  const room = sizes[at] + sizes[at + 1];
  const MIN = 0.1;
  let wanted = sizes[at];
  handle.setPointerCapture(event.pointerId);
  handle.classList.add('dragging');
  const nodes = [...container.children].filter((c) => c.classList.contains(axis === 'column' ? 'col' : 'cell'));
  const move = (e) => {
    const fraction = axis === 'column' ? (e.clientX - rect.left) / rect.width : (e.clientY - rect.top) / rect.height;
    wanted = Math.min(Math.max(fraction - before, MIN), room - MIN);
    nodes[at].style.flexGrow = String(wanted);
    nodes[at + 1].style.flexGrow = String(room - wanted);
  };
  const end = () => {
    endDrag = undefined;
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', end);
    handle.removeEventListener('pointercancel', end);
    handle.classList.remove('dragging');
    send({ ...message, size: wanted });
  };
  endDrag = end;
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

function cellNode(grid, column, columnData, row, rowData) {
  const cell = el('div', `cell${rowData.holds ? ' filled' : ''}`);
  cell.style.flexGrow = String(rowData.size);
  const select = el('select');
  select.dataset.key = `cell-${column}-${row}`;
  select.setAttribute('aria-label', `Column ${column + 1}, row ${row + 1}`);
  for (const choice of rowData.choices) {
    const option = el('option', '', choice.label);
    option.value = choice.value;
    option.selected = choice.value === rowData.holds;
    select.append(option);
  }
  select.addEventListener('change', () => send({ type: 'assign', column, row, holds: select.value }));
  const tools = el('div', 'tools');
  tools.append(button('Split', () => send({ type: 'addRow', column, row }), 'small', `split-${column}-${row}`));
  if (columnData.rows.length > 1) tools.append(button('Remove', () => send({ type: 'removeRow', column, row }), 'small', `rmrow-${column}-${row}`));
  cell.append(select);
  if (rowData.terminal) cell.append(el('div', 'summary', terminalSummary(rowData.terminal)));
  cell.append(tools);
  return cell;
}

// A cell is too small for the terminal's fields, so it shows a one-line summary; the fields are under the grid.
function terminalSummary(terminal) {
  const shell = terminal.shells.find((s) => s.value === terminal.shell);
  const parts = [terminal.name || terminal.placeholder];
  if (shell && shell.label !== parts[0]) parts.push(shell.label);
  if (terminal.folder) parts.push(terminal.folder);
  if (terminal.command) parts.push(terminal.command);
  return parts.join(' · ');
}

// One row of fields for each terminal cell, named by where it is in the grid.
function terminalsBlock(grid) {
  const cells = [];
  grid.columns.forEach((columnData, column) =>
    columnData.rows.forEach((rowData, row) => {
      if (rowData.terminal) cells.push({ column, row, terminal: rowData.terminal, rows: columnData.rows.length });
    }),
  );
  if (cells.length === 0) return undefined;
  const block = el('div', 'terminals');
  block.append(el('h3', '', 'Terminal cells'), el('p', 'hint', 'Leave a field empty to use the default shown in it.'));
  for (const { column, row, terminal, rows } of cells) {
    const where = rows > 1 ? `Column ${column + 1}, row ${row + 1}` : `Column ${column + 1}`;
    const card = el('div', 'terminal');
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', where);
    card.append(el('div', 'where', where), terminalFields(column, row, terminal));
    block.append(card);
  }
  return block;
}

// Which terminal a terminal cell opens. Any change sends all four fields, as the person sees them now.
function terminalFields(column, row, terminal) {
  const box = el('div', 'fields');
  const key = (field) => `terminal-${field}-${column}-${row}`;
  const shell = el('select');
  shell.dataset.key = key('shell');
  for (const choice of terminal.shells) {
    const option = el('option', '', choice.label);
    option.value = choice.value;
    option.selected = choice.value === terminal.shell;
    shell.append(option);
  }
  const text = (field, label, placeholder) => {
    const input = el('input');
    input.type = 'text';
    input.value = terminal[field];
    input.placeholder = placeholder;
    input.dataset.key = key(field);
    input.setAttribute('aria-label', `${label}, column ${column + 1}, row ${row + 1}`);
    return input;
  };
  const name = text('name', 'Name', terminal.placeholder);
  const folder = text('folder', 'Folder', 'Workspace folder');
  const command = text('command', 'Startup command', 'None');
  const changed = () =>
    send({ type: 'terminal', column, row, terminal: { shell: shell.value, name: name.value, folder: folder.value, command: command.value } });
  shell.setAttribute('aria-label', `Shell, column ${column + 1}, row ${row + 1}`);
  for (const control of [shell, name, folder, command]) control.addEventListener('change', changed);
  for (const [label, control] of [['Shell', shell], ['Name', name], ['Folder', folder], ['Startup command', command]]) {
    const line = el('label');
    line.append(el('span', '', label), control);
    box.append(line);
  }
  return box;
}

function columnNode(grid, column, columnData) {
  const col = el('div', 'col');
  col.style.flexGrow = String(columnData.size);
  if (grid.columns.length > 1) {
    const tools = el('div', 'tools');
    tools.append(button('Remove column', () => send({ type: 'removeColumn', index: column }), 'small', `rmcol-${column}`));
    col.append(tools);
  }
  const rows = el('div', 'rows');
  columnData.rows.forEach((rowData, row) => {
    rows.append(cellNode(grid, column, columnData, row, rowData));
    if (row < columnData.rows.length - 1) {
      const split = el('div', 'hsplit');
      split.setAttribute('role', 'separator');
      split.addEventListener('pointerdown', (e) => dragEdge(e, split, 'row', columnData.rows, row, { type: 'drag', axis: 'row', column, row }));
      rows.append(split);
    }
  });
  col.append(rows);
  return col;
}

function gridSection(state) {
  const grid = state.grid;
  const section = el('section');
  section.append(
    el('h2', '', '2. Build the editor columns'),
    el('p', 'hint', 'Columns sit side by side in the editor area; Split cuts a column into rows. Drag the edges to set sizes, and choose what each cell holds.'),
  );
  if (!grid.on) {
    section.append(el('p', 'note', 'No editor columns yet.'), button('Use editor columns', () => send({ type: 'useColumns' }), '', 'use-columns'));
    return section;
  }
  if (grid.note) {
    section.append(el('p', 'note', grid.note), button('Start over', () => send({ type: 'startOver' }), '', 'start-over'));
    return section;
  }
  if (grid.notice) {
    const notice = el('p', 'note', grid.notice);
    notice.setAttribute('role', 'status');
    section.append(notice);
  }
  const wrap = el('div', 'grid-wrap');
  const columns = el('div', 'columns');
  grid.columns.forEach((columnData, column) => {
    columns.append(columnNode(grid, column, columnData));
    if (column < grid.columns.length - 1) {
      const split = el('div', 'vsplit');
      split.setAttribute('role', 'separator');
      split.addEventListener('pointerdown', (e) => dragEdge(e, split, 'column', grid.columns, column, { type: 'drag', axis: 'column', column }));
      columns.append(split);
    }
  });
  wrap.append(
    button('+ Column', () => send({ type: 'addColumn', side: 'left' }), 'edge', 'add-left'),
    columns,
    button('+ Column', () => send({ type: 'addColumn', side: 'right' }), 'edge', 'add-right'),
  );
  section.append(wrap);
  const terminals = terminalsBlock(grid);
  if (terminals) section.append(terminals);
  section.append(button('Remove editor columns', () => send({ type: 'removeColumns' }), 'small', 'remove-columns'));
  return section;
}

function sizesSection(state) {
  const section = el('section', 'sizes');
  section.append(
    el('h2', '', '3. Side bar and panel sizes (optional)'),
    el('p', 'hint', 'As a percentage of the window. Leave a box empty to leave that size alone.'),
  );
  for (const row of state.sizes.rows) {
    const label = el('label');
    label.append(document.createTextNode(row.label));
    const input = el('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.value = row.percent;
    input.dataset.key = `size-${row.part}`;
    input.addEventListener('change', () => send({ type: 'size', part: row.part, value: input.value }));
    label.append(input, document.createTextNode('%'));
    section.append(label);
  }
  const use = el('div');
  use.append(button('Use current sizes', () => send({ type: 'useCurrentSizes' }), '', 'use-current-sizes'));
  section.append(use);
  if (!state.sizes.available) section.append(el('p', 'note', 'Sizes cannot be read in this build, so they cannot be captured. You can still type them.'));
  return section;
}

function resultNode(result) {
  if (!result.ok) {
    const bad = el('div', 'result bad');
    bad.setAttribute('role', 'alert');
    bad.append(document.createTextNode(result.problem));
    return bad;
  }
  const ok = el('div', 'result');
  ok.setAttribute('role', 'status');
  ok.append(
    document.createTextNode(
      (result.stale ? 'Saved what you had when you pressed Save and Reload. You changed something while it was saving, so press Save and Reload again to include that. ' : 'Saved. ') +
        'To see it, press Restore Layout now, or reload the window (Developer: Reload Window, or Ctrl+R) and it is applied when the window opens.',
    ),
  );
  const actions = el('div', 'actions');
  actions.append(
    button('Restore Layout now', () => send({ type: 'restore' }), 'primary', 'restore-now'),
    button('Reload window', () => send({ type: 'reload' }), '', 'reload-window'),
  );
  ok.append(actions);
  return ok;
}

function render(state) {
  // Every state update rebuilds the page, so remember which control had focus and give it back afterwards.
  const active = document.activeElement;
  const focused = active && active.dataset ? active.dataset.key : undefined;
  // A text field reports its change when it loses focus, so what is typed in the focused one is not sent yet: the state
  // still holds the old text, and drawing that would erase what the person is typing.
  const typed = focused && active.type === 'text' ? { value: active.value, from: active.selectionStart, to: active.selectionEnd } : undefined;
  if (state.result) [lastResult, saving] = [state.result, false];
  else if (state.clearResult) lastResult = undefined;
  app.replaceChildren(
    el('h1', '', 'Choose Layout'),
    el('p', 'intro', 'Choose your agents, where each one lives, and how the editor area is laid out. Nothing changes until you press Save and Reload.'),
    agentsSection(state),
    gridSection(state),
    sizesSection(state),
  );
  const footer = el('div', 'footer');
  footer.append(button('Save and Reload', save, 'primary', 'save'), button('Cancel', () => send({ type: 'cancel' }), '', 'cancel'));
  app.append(footer);
  if (lastResult) app.append(resultNode(lastResult));
  lockForSave();
  if (focused) {
    const again = [...app.querySelectorAll('[data-key]')].find((n) => n.dataset.key === focused);
    if (again) {
      again.focus();
      if (typed && again.type === 'text') {
        again.value = typed.value;
        again.setSelectionRange(typed.from, typed.to);
      }
    }
  }
}

window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'state') render(event.data);
});
send({ type: 'ready' });
