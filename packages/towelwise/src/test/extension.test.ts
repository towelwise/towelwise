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

  // Ctrl+Alt is AltGr on Windows, so Ctrl+Alt+letter steals typing on layouts where AltGr+letter types a character.
  test('default shortcuts are Ctrl+K chords and nothing mentions Ctrl+Alt', () => {
    const manifest = vscode.extensions.getExtension('towelwise.towelwise')?.packageJSON;
    const keys = Object.fromEntries(manifest.contributes.keybindings.map((k: { command: string; key: string }) => [k.command, k.key]));
    assert.deepStrictEqual(keys, { 'towelwise.hyperspace.toggle': 'ctrl+k h', 'towelwise.layout.restore': 'ctrl+k l' });
    assert.ok(!/ctrl\+alt/i.test(JSON.stringify(manifest.contributes)), 'a shortcut or step text still says Ctrl+Alt');
  });
});
