import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

// shortcut: a lock this old is treated as abandoned even if its pid is alive (pid reuse after a crash); raise it if a transition can run longer.
const MAX_LOCK_AGE_MS = 60 * 60 * 1000;
const LOCK_NAME = /^hyperspace\.lock\.[\w-]+$/;

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function lockIsLive(file: string): boolean {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    // Gone already is fine. Any other read error says nothing about the owner, so never treat it as dead.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
  try {
    const { pid, time } = JSON.parse(text);
    return processAlive(pid) && Date.now() - time < MAX_LOCK_AGE_MS;
  } catch {
    return false; // Corrupt content: locks are published by rename, so this is never a half-written live lock.
  }
}

// Every window locks with its own uniquely named file and only ever deletes that one, so a window can never remove
// another owner's lock. Having created ours, we back off if any other live lock exists; two racing windows may
// both back off, but never both proceed. Locks of dead owners are cleaned up here.
function acquire(storageDir: string): string | undefined {
  fs.mkdirSync(storageDir, { recursive: true });
  const id = randomUUID();
  const own = path.join(storageDir, `hyperspace.lock.${id}`);
  const tmp = path.join(storageDir, `hyperspace.tmp.${id}`);
  // Renamed into place so no other window ever reads a half-written lock.
  fs.writeFileSync(tmp, JSON.stringify({ pid: process.pid, time: Date.now() }));
  fs.renameSync(tmp, own);

  try {
    let busy = false;
    for (const name of fs.readdirSync(storageDir)) {
      const other = path.join(storageDir, name);
      if (!LOCK_NAME.test(name) || other === own) continue;
      if (lockIsLive(other)) busy = true;
      else fs.rmSync(other, { force: true });
    }
    if (!busy) return own;
  } catch (e) {
    fs.rmSync(own, { force: true });
    throw e;
  }
  fs.rmSync(own, { force: true });
  return undefined;
}

// One jump or restore at a time across all windows. A command that arrives mid-transition is ignored.
export async function withLock<T>(storageDir: string, fn: () => Promise<T>, busy: T): Promise<T> {
  const own = acquire(storageDir);
  if (!own) return busy;
  try {
    return await fn();
  } finally {
    fs.rmSync(own, { force: true });
  }
}
