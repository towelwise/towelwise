// The contract for the `towelwise.menus.towelwise` setting: the entries of the Towelwise menu in the menu bar.
// The Towelwise AI workbench patch reads the same shape. This validator is the written-down version of it, so a
// bad edit is reported to the person, and so the default can be checked against it in tests.

export interface MenuEntry {
  command: string;
  title: string;
  // Entries with the same group sit together; a change of group draws a separator.
  group: string;
  // A context-key expression. The entry shows only while it is true.
  when?: string;
}

export interface Validated {
  entries: MenuEntry[];
  problems: string[];
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

// A syntax check only, since the real parser lives in the workbench: balanced brackets and no && or || with
// nothing on one side. It catches the mistakes people actually make when typing one.
export function looksLikeExpression(when: string): boolean {
  if (when.trim() === '') return false;
  let depth = 0;
  for (const ch of when) {
    if (ch === '(') depth++;
    if (ch === ')' && --depth < 0) return false;
  }
  if (depth !== 0) return false;
  return when.split(/&&|\|\|/).every((operand) => operand.trim() !== '');
}

// One line per bad entry, so a typo in the setting is not silent. The entry is skipped; the rest still show.
export function logMenuProblems(raw: unknown, log: (line: string) => void): void {
  for (const problem of validateEntries(raw).problems) log(`menu setting: ${problem}; skipped`);
}

// Keeps the good entries in order and says what was wrong with the others, by position (1 is the first entry).
export function validateEntries(raw: unknown): Validated {
  if (!Array.isArray(raw)) return { entries: [], problems: ['the menu setting must be a list of entries'] };
  const entries: MenuEntry[] = [];
  const problems: string[] = [];
  raw.forEach((item: unknown, index) => {
    const at = `entry ${index + 1}`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      problems.push(`${at} is not an object`);
      return;
    }
    const { command, title, group, when } = item as Record<string, unknown>;
    if (!isText(command)) return void problems.push(`${at} needs a non-empty text "command"`);
    if (!isText(title)) return void problems.push(`${at} needs a non-empty text "title"`);
    if (group !== undefined && typeof group !== 'string') return void problems.push(`${at} has a "group" that is not text`);
    if (when !== undefined && (typeof when !== 'string' || !looksLikeExpression(when))) {
      return void problems.push(`${at} has a "when" that is not a valid condition`);
    }
    const entry: MenuEntry = { command, title, group: group ?? entries[entries.length - 1]?.group ?? '' };
    if (when !== undefined) entry.when = when;
    entries.push(entry);
  });
  return { entries, problems };
}
