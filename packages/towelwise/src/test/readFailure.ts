// eslint-disable-next-line @typescript-eslint/no-require-imports
const realFs = require('node:fs') as typeof import('node:fs');

/**
 * Makes reads of one file fail, as when antivirus or an indexer holds it for a moment. Nothing else is affected.
 * Call restore() to put the real read back.
 */
export function failReadOf(file: string, code = 'EACCES'): { restore(): void } {
  const real = realFs.readFileSync;
  const patched = realFs as { readFileSync: unknown };
  patched.readFileSync = (target: unknown, ...rest: unknown[]) => {
    if (target === file) throw Object.assign(new Error(`${code}: simulated read failure`), { code });
    return (real as (...args: unknown[]) => unknown)(target, ...rest);
  };
  return { restore: () => void (patched.readFileSync = real) };
}
