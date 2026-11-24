import { describe, expect, it } from 'vitest';
import { CronError, nextRun, nextRuns, parseCron, validateCron } from '../src/cron/cron.js';

const at = (iso: string) => new Date(iso);
const next = (expr: string, iso: string) =>
  nextRun(parseCron(expr), at(iso))?.toISOString() ?? null;

describe('parseCron', () => {
  it('expands wildcards, ranges, lists and steps', () => {
    const s = parseCron('*/15 9-17 1,15 * MON-FRI');
    expect(s.minutes).toEqual([0, 15, 30, 45]);
    expect(s.hours).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(s.daysOfMonth).toEqual([1, 15]);
    expect(s.months).toHaveLength(12);
    expect(s.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(s.domRestricted).toBe(true);
    expect(s.dowRestricted).toBe(true);
  });

  it('supports stepped ranges, start/step and names', () => {
    expect(parseCron('10-50/20 * * * *').minutes).toEqual([10, 30, 50]);
    expect(parseCron('5/20 * * * *').minutes).toEqual([5, 25, 45]);
    expect(parseCron('0 0 * jan,Jul *').months).toEqual([1, 7]);
  });

  it('normalises 7 to Sunday and de-duplicates', () => {
    expect(parseCron('0 0 * * 0,7').daysOfWeek).toEqual([0]);
    expect(parseCron('0 0 * * 5-7').daysOfWeek).toEqual([0, 5, 6]);
  });

  it('expands macros', () => {
    expect(parseCron('@hourly').minutes).toEqual([0]);
    expect(parseCron('@daily').hours).toEqual([0]);
    expect(parseCron('@weekly').daysOfWeek).toEqual([0]);
    expect(parseCron('@monthly').daysOfMonth).toEqual([1]);
    expect(parseCron('@YEARLY').months).toEqual([1]);
  });

  it.each([
    ['', /expected 5 fields/],
    ['* * * *', /expected 5 fields/],
    ['60 * * * *', /minute: 60 is outside 0-59/],
    ['* 24 * * *', /hour/],
    ['* * 0 * *', /day-of-month/],
    ['* * * 13 *', /month/],
    ['* * * * 8', /day-of-week/],
    ['*/0 * * * *', /step must be at least 1/],
    ['5-1 * * * *', /range start/],
    ['1-2-3 * * * *', /invalid range/],
    ['*/2/3 * * * *', /invalid step/],
    ['a * * * *', /invalid value/],
    ['1,,2 * * * *', /empty list item/],
    ['@reboot', /unknown macro/],
    ['* * * * FOO', /invalid value/],
  ])('rejects %j', (expr, message) => {
    expect(() => parseCron(expr)).toThrow(message);
  });

  it('validateCron returns messages instead of throwing', () => {
    expect(validateCron('* * * * *')).toBeNull();
    expect(validateCron('nope')).toMatch(/expected 5 fields/);
    expect(new CronError('x')).toBeInstanceOf(Error);
  });
});

describe('nextRun', () => {
  it.each([
    ['* * * * *', '2026-01-01T00:00:30Z', '2026-01-01T00:01:00.000Z'],
    ['*/15 * * * *', '2026-01-01T00:14:00Z', '2026-01-01T00:15:00.000Z'],
    ['*/15 * * * *', '2026-01-01T00:15:00Z', '2026-01-01T00:30:00.000Z'],
    ['0 3 * * *', '2026-01-01T03:00:00Z', '2026-01-02T03:00:00.000Z'],
    ['0 3 * * *', '2026-01-01T02:59:59Z', '2026-01-01T03:00:00.000Z'],
    ['30 23 31 12 *', '2026-06-01T00:00:00Z', '2026-12-31T23:30:00.000Z'],
    ['0 0 1 * *', '2026-01-31T12:00:00Z', '2026-02-01T00:00:00.000Z'],
    ['0 0 29 2 *', '2026-03-01T00:00:00Z', '2028-02-29T00:00:00.000Z'],
    ['0 9 * * MON', '2026-11-24T10:00:00Z', '2026-11-30T09:00:00.000Z'],
    ['59 23 * * *', '2026-12-31T23:59:00Z', '2027-01-01T23:59:00.000Z'],
    ['0 12 * * 1-5', '2026-11-28T00:00:00Z', '2026-11-30T12:00:00.000Z'],
  ])('%s after %s', (expr, after, expected) => {
    expect(next(expr, after)).toBe(expected);
  });

  it('uses OR semantics when both day fields are restricted', () => {
    // 13th of the month OR any Friday
    const runs = nextRuns(parseCron('0 0 13 * 5'), at('2026-11-01T00:00:00Z'), 3).map((d) =>
      d.toISOString(),
    );
    expect(runs).toEqual([
      '2026-11-06T00:00:00.000Z',
      '2026-11-13T00:00:00.000Z',
      '2026-11-20T00:00:00.000Z',
    ]);
  });

  it('uses AND semantics when day-of-month is a wildcard', () => {
    expect(next('0 0 * * 5', '2026-11-01T00:00:00Z')).toBe('2026-11-06T00:00:00.000Z');
  });

  it('returns null for impossible schedules', () => {
    expect(next('0 0 30 2 *', '2026-01-01T00:00:00Z')).toBeNull();
    expect(next('0 0 31 4 *', '2026-01-01T00:00:00Z')).toBeNull();
  });

  it('produces strictly increasing sequences', () => {
    const runs = nextRuns(parseCron('*/7 */5 * * *'), at('2026-02-27T22:00:00Z'), 50);
    expect(runs).toHaveLength(50);
    for (let i = 1; i < runs.length; i += 1) {
      expect((runs[i] as Date).getTime()).toBeGreaterThan((runs[i - 1] as Date).getTime());
      expect((runs[i] as Date).getUTCMinutes() % 7).toBe(0);
      expect((runs[i] as Date).getUTCHours() % 5).toBe(0);
    }
  });

  it('agrees with a brute-force minute scan (property)', () => {
    const exprs = [
      '5,35 */3 * * *',
      '0 0 1,15 * 3',
      '*/20 8-18 * 2-11 1-5',
      '0 0 L * *'.replace('L', '28'),
    ];
    for (const expr of exprs) {
      const schedule = parseCron(expr);
      let cursor = at('2026-03-01T00:00:00Z');
      for (let i = 0; i < 10; i += 1) {
        const fast = nextRun(schedule, cursor) as Date;
        const slow = bruteForce(expr, cursor);
        expect(fast.toISOString()).toBe(slow.toISOString());
        cursor = fast;
      }
    }
  });
});

function bruteForce(expr: string, after: Date): Date {
  const s = parseCron(expr);
  const t = new Date(after.getTime());
  t.setUTCSeconds(0, 0);
  for (let i = 0; i < 60 * 24 * 400; i += 1) {
    t.setUTCMinutes(t.getUTCMinutes() + 1);
    const dom = s.daysOfMonth.includes(t.getUTCDate());
    const dow = s.daysOfWeek.includes(t.getUTCDay());
    const day =
      s.domRestricted && s.dowRestricted
        ? dom || dow
        : s.domRestricted
          ? dom
          : s.dowRestricted
            ? dow
            : true;
    if (
      s.minutes.includes(t.getUTCMinutes()) &&
      s.hours.includes(t.getUTCHours()) &&
      s.months.includes(t.getUTCMonth() + 1) &&
      day
    ) {
      return new Date(t.getTime());
    }
  }
  throw new Error('no match');
}
