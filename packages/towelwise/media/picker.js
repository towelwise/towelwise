// The page only draws what the extension sends and reports clicks. It never decides what Keep or Hide means.
const vscodeApi = acquireVsCodeApi();
const app = document.getElementById('app');

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
    button.setAttribute('aria-label', `${item.label}: ${hide ? 'hide' : 'keep'}`);
    button.append(el('span', 'name', item.label), el('span', 'badge', hide ? 'Hide' : 'Keep'));
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

  const labelOf = (option) => state.items.find((i) => i.option === option)?.label ?? option;
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
