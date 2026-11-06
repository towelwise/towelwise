import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('towelwise.towelwise', () => {
  test('is installed and activates without error', async () => {
    const ext = vscode.extensions.getExtension('towelwise.towelwise');
    assert.ok(ext, 'extension not found');
    await ext.activate();
    assert.strictEqual(ext.isActive, true);
    const commands = await vscode.commands.getCommands(true);
    for (const id of ['towelwise.hyperspace.toggle', 'towelwise.hyperspace.edit', 'towelwise.layout.choose', 'towelwise.layout.restore']) {
      assert.ok(commands.includes(id), `${id} not registered`);
    }
  });

  test('Edit Hyperspace Layout is in the palette and has no default shortcut', () => {
    const contributes = vscode.extensions.getExtension('towelwise.towelwise')?.packageJSON.contributes;
    const command = contributes.commands.find((c: { command: string }) => c.command === 'towelwise.hyperspace.edit');
    assert.strictEqual(command?.title, 'Towelwise: Edit Hyperspace Layout');
    assert.ok(!contributes.keybindings.some((k: { command: string }) => k.command === 'towelwise.hyperspace.edit'));
  });

  test('works in a project that is not trusted, with startup commands withheld (decision 0006)', () => {
    const untrusted = vscode.extensions.getExtension('towelwise.towelwise')?.packageJSON.capabilities?.untrustedWorkspaces;
    assert.strictEqual(untrusted?.supported, 'limited');
    assert.match(untrusted.description, /startup command/i);
  });

  test('a project cannot override the layout settings', () => {
    const configuration = vscode.extensions.getExtension('towelwise.towelwise')?.packageJSON.contributes.configuration;
    const layout = Object.entries<{ scope?: string }>(
      Object.assign({}, ...configuration.map((c: { properties: object }) => c.properties)),
    ).filter(([key]) => key.startsWith('towelwise.layout.'));
    assert.deepStrictEqual(
      layout.map(([key]) => key).sort(),
      [
        'towelwise.layout.agents',
        'towelwise.layout.applyOnStartup',
        'towelwise.layout.commands',
        'towelwise.layout.containers',
        'towelwise.layout.grid',
        'towelwise.layout.sizes',
      ],
    );
    for (const [key, schema] of layout) assert.strictEqual(schema.scope, 'application', key);
  });

  // Ctrl+Alt is AltGr on Windows, so Ctrl+Alt+letter steals typing on layouts where AltGr+letter types a character.
  test('default shortcuts are single Alt+Shift presses and nothing mentions Ctrl+Alt', () => {
    const manifest = vscode.extensions.getExtension('towelwise.towelwise')?.packageJSON;
    const keys = Object.fromEntries(manifest.contributes.keybindings.map((k: { command: string; key: string }) => [k.command, k.key]));
    assert.deepStrictEqual(keys, { 'towelwise.hyperspace.toggle': 'alt+shift+j', 'towelwise.layout.restore': 'alt+shift+l' });
    assert.ok(!/ctrl\+alt/i.test(JSON.stringify(manifest.contributes)), 'a shortcut or step text still says Ctrl+Alt');
  });

  test('hyperspace hides the palette box and layout buttons by default, with no scope of their own', () => {
    const configuration = vscode.extensions.getExtension('towelwise.towelwise')?.packageJSON.contributes.configuration;
    const props = configuration.find((c: { title: string }) => c.title === 'Towelwise: Hyperspace').properties;
    for (const name of ['towelwise.hyperspace.hideCommandCenter', 'towelwise.hyperspace.hideLayoutControls']) {
      assert.strictEqual(props[name].type, 'boolean');
      assert.strictEqual(props[name].default, true);
      assert.strictEqual(props[name].scope, undefined);
    }
  });

  test('the sizes setting accepts proportions and an orientation, and nothing else', () => {
    const configuration = vscode.extensions.getExtension('towelwise.towelwise')?.packageJSON.contributes.configuration;
    const sizes = configuration.find((c: { title: string }) => c.title === 'Towelwise: Hyperspace').properties['towelwise.hyperspace.sizes'];
    assert.strictEqual(sizes.type, 'object');
    assert.deepStrictEqual(sizes.default, {});
    assert.strictEqual(sizes.scope, undefined);
    assert.strictEqual(sizes.additionalProperties, false);
    assert.deepStrictEqual(Object.keys(sizes.properties), ['sidebar', 'auxiliarybar', 'panel', 'panelOrientation']);
  });

  test('the editor grid setting is an object with an orientation and groups, and nothing else', () => {
    const configuration = vscode.extensions.getExtension('towelwise.towelwise')?.packageJSON.contributes.configuration;
    const grid = configuration.find((c: { title: string }) => c.title === 'Towelwise: Hyperspace').properties['towelwise.hyperspace.editorGrid'];
    assert.strictEqual(grid.type, 'object');
    assert.deepStrictEqual(grid.default, {});
    assert.strictEqual(grid.scope, undefined);
    assert.strictEqual(grid.additionalProperties, false);
    assert.deepStrictEqual(Object.keys(grid.properties), ['orientation', 'groups']);
  });
});
