/**
 * In-house cron parser (5-field, UTC), compatible with the common Vixie cron dialect:
 *   minute hour day-of-month month day-of-week
 * Supports `*`, lists (`1,5`), ranges (`1-5`), steps (`*\/15`, `10-50/10`), month and weekday
 * names (JAN-DEC, SUN-SAT), 7 as Sunday, and the macros @yearly/@annually/@monthly/@weekly/
 * @daily/@midnight/@hourly. When both day-of-month and day-of-week are restricted a day
 * matches if EITHER matches (classic cron semantics).
 */

export class CronError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CronError';
  }
}

interface FieldDef {
  readonly name: string;
  readonly min: number;
  readonly max: number;
  readonly names?: readonly string[];
}

const FIELDS: readonly FieldDef[] = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day-of-month', min: 1, max: 31 },
  {
    name: 'month',
    min: 1,
    max: 12,
    names: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
  },
  { name: 'day-of-week', min: 0, max: 7, names: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] },
];

const MACROS: Readonly<Record<string, string>> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

export interface CronSchedule {
  readonly source: string;
  readonly minutes: readonly number[];
  readonly hours: readonly number[];
  readonly daysOfMonth: readonly number[];
  readonly months: readonly number[];
  readonly daysOfWeek: readonly number[];
  readonly domRestricted: boolean;
  readonly dowRestricted: boolean;
}

export function parseCron(expression: string): CronSchedule {
  const trimmed = expression.trim();
  const expanded = MACROS[trimmed.toLowerCase()] ?? trimmed;
  if (expanded.startsWith('@')) throw new CronError(`unknown macro '${trimmed}'`);
  const parts = expanded.split(/\s+/);
  if (parts.length !== 5) {
    throw new CronError(
      `expected 5 fields (minute hour day-of-month month day-of-week), got ${parts.length}`,
    );
  }
  const [minutes, hours, dom, months, dowRaw] = parts.map((part, i) =>
    parseField(part, FIELDS[i] as FieldDef),
  );
  const daysOfWeek = [...new Set((dowRaw as number[]).map((d) => (d === 7 ? 0 : d)))].sort(
    (a, b) => a - b,
  );
  return {
    source: trimmed,
    minutes: minutes as number[],
    hours: hours as number[],
    daysOfMonth: dom as number[],
    months: months as number[],
    daysOfWeek,
    domRestricted: !(parts[2] as string).startsWith('*'),
    dowRestricted: !(parts[4] as string).startsWith('*'),
  };
}

function parseField(text: string, field: FieldDef): number[] {
  const values = new Set<number>();
  for (const item of text.split(',')) {
    if (item === '') throw new CronError(`${field.name}: empty list item`);
    for (const value of parseItem(item, field)) values.add(value);
  }
  return [...values].sort((a, b) => a - b);
}

function parseItem(item: string, field: FieldDef): number[] {
  const [rangePart, stepPart, extra] = item.split('/');
  if (extra !== undefined) throw new CronError(`${field.name}: invalid step expression '${item}'`);
  const step = stepPart === undefined ? 1 : parseNumber(stepPart, field, 'step');
  if (step < 1) throw new CronError(`${field.name}: step must be at least 1`);
  const [start, end] = parseRange(rangePart as string, field, stepPart !== undefined);
  if (start > end) throw new CronError(`${field.name}: range start ${start} is after end ${end}`);
  const out: number[] = [];
  for (let v = start; v <= end; v += step) out.push(v);
  return out;
}

function parseRange(text: string, field: FieldDef, hasStep: boolean): [number, number] {
  if (text === '*') return [field.min, field.max];
  const [lo, hi, extra] = text.split('-');
  if (extra !== undefined) throw new CronError(`${field.name}: invalid range '${text}'`);
  const start = parseValue(lo as string, field);
  if (hi === undefined) return hasStep ? [start, field.max] : [start, start];
  return [start, parseValue(hi, field)];
}

function parseValue(text: string, field: FieldDef): number {
  const nameIndex = field.names?.indexOf(text.toUpperCase()) ?? -1;
  if (nameIndex >= 0) return nameIndex + (field.name === 'month' ? 1 : 0);
  const value = parseNumber(text, field, 'value');
  if (value < field.min || value > field.max) {
    throw new CronError(`${field.name}: ${value} is outside ${field.min}-${field.max}`);
  }
  return value;
}

function parseNumber(text: string, field: FieldDef, what: string): number {
  if (!/^\d{1,4}$/.test(text)) throw new CronError(`${field.name}: invalid ${what} '${text}'`);
  return Number(text);
}

function dayMatches(schedule: CronSchedule, date: Date): boolean {
  const dom = schedule.daysOfMonth.includes(date.getUTCDate());
  const dow = schedule.daysOfWeek.includes(date.getUTCDay());
  if (schedule.domRestricted && schedule.dowRestricted) return dom || dow;
  if (schedule.domRestricted) return dom;
  if (schedule.dowRestricted) return dow;
  return true;
}

const MAX_SEARCH_YEARS = 9;

/**
 * Next fire time strictly after `after` (minute resolution, UTC), or null when the schedule
 * can never fire (e.g. `0 0 30 2 *`). Jumps month -> day -> hour -> minute instead of scanning
 * minute by minute, so worst case is a few thousand iterations across the search window.
 */
export function nextRun(schedule: CronSchedule, after: Date): Date | null {
  const t = new Date(after.getTime());
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(t.getUTCMinutes() + 1);
  const limitYear = t.getUTCFullYear() + MAX_SEARCH_YEARS;
  while (t.getUTCFullYear() <= limitYear) {
    if (!schedule.months.includes(t.getUTCMonth() + 1)) {
      t.setUTCMonth(t.getUTCMonth() + 1, 1);
      t.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(schedule, t)) {
      t.setUTCDate(t.getUTCDate() + 1);
      t.setUTCHours(0, 0, 0, 0);
      continue;
    }
    const hour = schedule.hours.find((h) => h >= t.getUTCHours());
    if (hour === undefined) {
      t.setUTCDate(t.getUTCDate() + 1);
      t.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (hour > t.getUTCHours()) {
      t.setUTCHours(hour, 0, 0, 0);
    }
    const minute = schedule.minutes.find((m) => m >= t.getUTCMinutes());
    if (minute === undefined) {
      t.setUTCHours(t.getUTCHours() + 1, 0, 0, 0);
      continue;
    }
    t.setUTCMinutes(minute);
    return t;
  }
  return null;
}

/** The next `count` fire times after `after`. */
export function nextRuns(schedule: CronSchedule, after: Date, count: number): Date[] {
  const out: Date[] = [];
  let cursor: Date | null = after;
  while (out.length < count && cursor) {
    cursor = nextRun(schedule, cursor);
    if (cursor) out.push(cursor);
  }
  return out;
}

/** Validation helper: returns an error message or null. */
export function validateCron(expression: string): string | null {
  try {
    parseCron(expression);
    return null;
  } catch (err) {
    return err instanceof CronError ? err.message : String(err);
  }
}
