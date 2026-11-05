import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/out/**', '**/.vscode-test/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Pages that run inside a webview, not in Node.
    files: ['**/media/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { acquireVsCodeApi: 'readonly', document: 'readonly', window: 'readonly' },
    },
  },
);
