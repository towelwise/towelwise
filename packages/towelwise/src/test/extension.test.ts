import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('towelwise.towelwise', () => {
  test('is installed and activates without error', async () => {
    const ext = vscode.extensions.getExtension('towelwise.towelwise');
    assert.ok(ext, 'extension not found');
    await ext.activate();
    assert.strictEqual(ext.isActive, true);
  });
});
