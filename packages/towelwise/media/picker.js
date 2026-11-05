// The page only draws what the extension sends and reports clicks. It never decides what Keep or Hide means.
const vscodeApi = acquireVsCodeApi();
const app = document.getElementById('app');

// Which resizable area an item is, to look up what is open in it.
const PART = { hidePrimarySideBar: 'sidebar', hideSecondarySideBar: 'auxiliarybar', hideBottomPanel: 'panel' };

// Where each item sits in the mock window.
const AREA = {
  hideMenuBar: 'menu',
  hideCommandCenter: 'palette',
  hideLayoutControls: 'layout',
  hideActivityBar: 'act',
  hidePrimarySideBar: 'pri',
  hideSecondarySideBar: 'sec',
  hideBottomPanel: 'panel',
  hideStatusBar: 'status',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The last Save result stays on screen across redraws until the next Save.
let lastResult;

function render(state) {
  // Every state update rebuilds the page, so remember which control had focus and give it back afterwards.
  const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.key : undefined;
  if (state.result) lastResult = state.result;
  app.replaceChildren();
  app.append(
    el('h1', '', 'Edit Hyperspace Layout'),
    el('p', 'intro', 'Click a part of the window to choose what hyperspace does with it when you jump. Nothing changes until you press Save.'),
  );

  const mock = el('div', 'mock');
  for (const item of state.items.filter((i) => i.kind !== 'switch')) {
    const hide = item.choice === 'hide';
    const button = el('button', `part ${hide ? 'hide' : 'keep'}`);
    button.dataset.area = AREA[item.option];
    button.dataset.key = item.option;
    button.setAttribute('aria-pressed', String(hide));
    const open = state.names && PART[item.option] ? state.names[PART[item.option]] : undefined;
    button.setAttribute('aria-label', `${item.label}${open ? ', showing ' + open : ''}: ${hide ? 'hide' : 'keep'}`);
    button.append(el('span', 'name', item.label), el('span', 'badge', hide ? 'Hide' : 'Keep'));
    if (open) button.append(el('span', 'open', open));
    if (item.overridden) button.append(el('span', 'note', 'set by this project'));
    button.addEventListener('click', () => vscodeApi.postMessage({ type: 'choose', option: item.option, choice: hide ? 'keep' : 'hide' }));
    mock.append(button);
  }
  const editor = el('div', 'part editor');
  editor.dataset.area = 'editor';
  editor.append(el('span', 'name', 'Editor area'), el('span', 'badge', 'Always kept'));
  mock.append(editor);
  app.append(mock);

  app.append(
    el('p', 'legend', 'Hide: hyperspace hides or closes it on the next jump. Keep: hyperspace leaves it exactly as it is. Keep never shows something that is already hidden or reopens a closed area.'),
  );

  const full = state.items.find((i) => i.kind === 'switch');
  const label = el('label', 'switch');
  const box = el('input');
  box.type = 'checkbox';
  box.dataset.key = 'fullScreen';
  box.checked = full.on === true;
  box.addEventListener('change', () => vscodeApi.postMessage({ type: 'fullScreen', on: box.checked }));
  label.append(box, el('span', '', 'Also go full screen when jumping, and leave it on restore. Start from a windowed window.'));
  if (full.overridden) label.append(el('span', 'note', 'set by this project'));
  app.append(label);

  // Sizes: percentages of the window. Typing is sent when the field is committed, so a redraw never eats keystrokes.
  if (state.sizes) {
    const box = el('section', 'sizes');
    box.append(el('h2', '', 'Sizes'));
    if (!state.sizes.available) {
      box.append(el('p', 'info', state.sizes.note || 'Sizes need Towelwise AI.'));
    } else {
      box.append(el('p', 'legend', 'Percent of the window. Drag the side bars and panel the way you like, then press Use current sizes. Leave a box empty to keep that part as it is.'));
      const use = el('button', '', 'Use current sizes');
      use.dataset.key = 'useCurrentSizes';
      use.addEventListener('click', () => vscodeApi.postMessage({ type: 'useCurrentSizes' }));
      box.append(use);
      for (const row of state.sizes.rows) {
        const label = el('label', 'size');
        const input = el('input');
        input.type = 'text';
        input.inputMode = 'decimal';
        input.dataset.key = `size-${row.part}`;
        input.value = row.percent === undefined ? '' : String(Math.round(row.percent * 10) / 10);
        input.addEventListener('change', () => vscodeApi.postMessage({ type: 'size', part: row.part, value: input.value }));
        const suffix = row.part === 'panel' && state.sizes.panelOrientation ? (state.sizes.panelOrientation === 'down' ? '% of the height' : '% of the width') : '% of the width';
        label.append(el('span', 'size-name', row.label), input, el('span', '', suffix));
        box.append(label);
      }
      if (state.sizes.note) box.append(el('p', 'info', state.sizes.note));
    }
    app.append(box);
  }

  // Editor grid: captured from the live editor area, shown as nested boxes sized by their proportions.
  if (state.grid) {
    const box = el('section', 'grid');
    box.append(el('h2', '', 'Editor grid'));
    box.append(el('p', 'legend', 'Arrange the columns and rows in the editor area yourself, drag your agents and terminals into them, then press Use current layout. Hyperspace re-applies the proportions; it never opens or moves anything.'));
    const use = el('button', '', 'Use current layout');
    use.dataset.key = 'useCurrentLayout';
    use.addEventListener('click', () => vscodeApi.postMessage({ type: 'useCurrentLayout' }));
    const clear = el('button', '', 'Clear');
    clear.dataset.key = 'clearGrid';
    clear.addEventListener('click', () => vscodeApi.postMessage({ type: 'clearGrid' }));
    const buttons = el('div', 'actions');
    buttons.append(use, clear);
    box.append(buttons);
    const draw = (nodes, horizontal) => {
      const row = el('div', horizontal ? 'cells across' : 'cells down');
      for (const node of nodes) {
        const cell = el('div', node.groups ? 'cell split' : 'cell');
        cell.style.flexGrow = String(Math.round(node.size * 1000));
        if (node.groups) cell.append(draw(node.groups, !horizontal));
        else cell.append(el('span', 'cell-label', node.label || 'Editor group'));
        row.append(cell);
      }
      return row;
    };
    if (state.grid.saved) {
      const mock = draw(state.grid.saved.groups, state.grid.saved.orientation === 0);
      mock.classList.add('grid-mock');
      mock.setAttribute('role', 'img');
      mock.setAttribute('aria-label', 'The editor grid that will be saved');
      box.append(mock);
    } else {
      box.append(el('p', 'info', 'No editor grid is saved. Hyperspace leaves the editor area as it is.'));
    }
    if (state.grid.note) box.append(el('p', 'info', state.grid.note));
    app.append(box);
  }

  if (state.hyperspaceOn) {
    app.append(el('p', 'info', 'Hyperspace is on now. What you save applies from the next jump; this session is unchanged.'));
  }

  const save = el('button', 'primary', 'Save');
  save.dataset.key = 'save';
  save.addEventListener('click', () => vscodeApi.postMessage({ type: 'save' }));
  const cancel = el('button', '', 'Cancel');
  cancel.dataset.key = 'cancel';
  cancel.addEventListener('click', () => vscodeApi.postMessage({ type: 'cancel' }));
  const actions = el('div', 'actions');
  actions.append(save, cancel);
  app.append(actions);

  const labelOf = (option) => (option === 'sizes' ? 'Sizes' : option === 'editorGrid' ? 'Editor grid' : state.items.find((i) => i.option === option)?.label ?? option);
  const status = el('p', 'status');
  status.setAttribute('role', 'status');
  if (lastResult) {
    const { written, failed } = lastResult;
    if (failed) {
      status.textContent = `Could not save ${labelOf(failed.option)}: ${failed.message}. Your other choices are kept; press Save to try again.`;
      status.className = 'status error';
    } else {
      status.textContent = written.length === 0 ? 'Nothing to save.' : `Saved ${written.length} ${written.length === 1 ? 'change' : 'changes'} to your user settings.`;
    }
  }
  app.append(status);

  // Saved changes stay saved, so list them apart from the draft: Cancel closes the panel but does not undo them.
  if (state.saved && state.saved.length > 0) {
    app.append(el('p', 'saved', `Already saved: ${state.saved.map(labelOf).join(', ')}. Cancel will not undo these.`));
  }

  if (focused) {
    const again = [...app.querySelectorAll('[data-key]')].find((node) => node.dataset.key === focused);
    if (again) again.focus();
  }
}

window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'state') render(event.data);
});
vscodeApi.postMessage({ type: 'ready' });
