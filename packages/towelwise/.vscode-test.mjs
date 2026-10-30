import { defineConfig } from '@vscode/test-cli';

// Many tests write real settings files; a CI runner can take several times longer than mocha's 2s default.
export default defineConfig({
  files: 'out/test/**/*.test.js',
  workspaceFolder: './test-workspace',
  mocha: { timeout: 10_000 },
});
