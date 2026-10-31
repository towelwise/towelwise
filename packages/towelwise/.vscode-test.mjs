import process from 'node:process';
import { defineConfig } from '@vscode/test-cli';

// Many tests write real settings files; a CI runner can take several times longer than mocha's 2s default.
// VSCODE_TEST_VERSION pins the VS Code the tests run in (CI uses it to test the minimum the extension claims).
export default defineConfig({
  version: process.env.VSCODE_TEST_VERSION ?? 'stable',
  files: 'out/test/**/*.test.js',
  workspaceFolder: './test-workspace',
  mocha: { timeout: 10_000 },
});
