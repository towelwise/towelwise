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

// Quoted text and regular expressions are values, not syntax: a bracket or && inside them means nothing. They are
// replaced by a placeholder so the checks below see only real operators and brackets.
function withoutValues(when: string): string {
  let out = '';
  let i = 0;
  while (i < when.length) {
    const ch = when[i];
    if (ch === "'" || ch === '"') {
      i++;
      while (i < when.length && when[i] !== ch) i += when[i] === '\\' ? 2 : 1;
      i++;
      out += 'x';
    } else if (ch === '/' && /=~\s*$/.test(out)) {
      i++;
      // A / inside a character class ([...]) is part of the expression, not its end.
      let inClass = false;
      while (i < when.length && (inClass || when[i] !== '/')) {
        if (when[i] === '\\') i += 2;
        else {
          if (when[i] === '[') inClass = true;
          else if (when[i] === ']') inClass = false;
          i++;
        }
      }
      i++;
      while (/[a-z]/i.test(when[i] ?? '')) i++; // flags
      out += 'x';
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

// A syntax check only, since the real parser lives in the workbench: balanced brackets and no && or || with
// nothing on one side. It catches the mistakes people actually make when typing one, and it does not reject
// what the real parser accepts (the core skips an entry it cannot parse and logs it).
export function looksLikeExpression(when: string): boolean {
  if (when.trim() === '') return false;
  const syntax = withoutValues(when);
  let depth = 0;
  for (const ch of syntax) {
    if (ch === '(') depth++;
    if (ch === ')' && --depth < 0) return false;
  }
  if (depth !== 0) return false;
  return syntax.split(/&&|\|\|/).every((operand) => operand.trim() !== '');
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
