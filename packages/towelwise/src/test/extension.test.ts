import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('towelwise.towelwise', () => {
  test('is installed and activates without error', async () => {
    const ext = vscode.extensions.getExtension('towelwise.towelwise');
    assert.ok(ext, 'extension not found');
    await ext.activate();
    assert.strictEqual(ext.isActive, true);
    const commands = await vscode.commands.getCommands(true);
    for (const id of ['towelwise.hyperspace.toggle', 'towelwise.layout.choose', 'towelwise.layout.restore']) {
      assert.ok(commands.includes(id), `${id} not registered`);
    }
  });

  test('a project cannot override the layout settings', () => {
    const configuration = vscode.extensions.getExtension('towelwise.towelwise')?.packageJSON.contributes.configuration;
    const layout = Object.entries<{ scope?: string }>(
      Object.assign({}, ...configuration.map((c: { properties: object }) => c.properties)),
    ).filter(([key]) => key.startsWith('towelwise.layout.'));
    assert.deepStrictEqual(
      layout.map(([key]) => key).sort(),
      ['towelwise.layout.applyOnStartup', 'towelwise.layout.commands', 'towelwise.layout.containers'],
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
});
