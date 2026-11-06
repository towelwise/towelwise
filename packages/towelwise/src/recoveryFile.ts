import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Reads a recovery file, which may hold the only copy of the user's settings. A file that is not there reads as
 * undefined. Any other failure to read it (antivirus or an indexer holding it, a permission error) throws and leaves the
 * file alone: a read that fails is not the same as a file that is damaged, and only damaged content may be dropped.
 */
export function readRecoveryText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return undefined;
    throw new Error(`${path.basename(file)} could not be read just now (${code ?? 'unknown error'}), so it was kept. Try again in a moment.`);
  }
}
