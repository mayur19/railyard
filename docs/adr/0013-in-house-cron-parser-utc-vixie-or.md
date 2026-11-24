# ADR-0013: In-house cron parser, UTC first, with Vixie OR semantics for day fields

- Status: Accepted
- Date: 2026-11-24
- Tickets: RY-100; RY-102 (scheduler daemon), RY-103 (IANA time zones)

## Context

Pipelines declare scheduled triggers (`on: schedule: [{ cron: '0 3 * * 1-5' }]`). The validator must reject invalid expressions with readable messages at validation time, the UI must show the next fire times, and the scheduler daemon (RY-102) must compute the next run efficiently and identically. Time zones and daylight-saving transitions are a classic source of double or missed runs.

## Decision Drivers

- Identical parsing in browser (preview) and server (scheduler).
- Familiar dialect: 5 fields, names, ranges, lists, steps, macros.
- Correct handling of the day-of-month / day-of-week interaction.
- Efficient `nextRun` (no minute-by-minute scan over years).
- Detect schedules that can never fire (`0 0 30 2 *`).
- Defer DST complexity until there is an explicit design for it.

## Considered Options

1. A third-party cron library.
2. In-house parser, local server time.
3. In-house parser, UTC only now; IANA time zones added later as an explicit per-schedule field.
4. Quartz-style 6/7-field syntax with seconds and `?`, `L`, `W`, `#`.

## Decision Outcome

Chosen option: **3**, `packages/shared/src/cron/cron.ts`.

- Fields: minute 0-59, hour 0-23, day-of-month 1-31, month 1-12 or `JAN-DEC`, day-of-week 0-7 or `SUN-SAT` with 7 normalised to Sunday. Supports `*`, lists, ranges, steps (`*/15`, `10-50/10`, `5/10` meaning from 5 to max), and macros `@yearly`, `@annually`, `@monthly`, `@weekly`, `@daily`, `@midnight`, `@hourly`. Errors name the field (`hour: 24 is outside 0-23`).
- **Vixie semantics**: when both day-of-month and day-of-week are restricted (do not start with `*`), a day matches if **either** matches; when only one is restricted, only that one applies.
- `nextRun(schedule, after)` returns the first minute strictly after `after` in UTC by jumping: wrong month -> first day of next month; wrong day -> next day; no remaining hour -> next day; no remaining minute -> next hour. It stops after a 9-year search window (long enough for Feb 29 schedules) and returns `null` for impossible schedules.

### Consequences

- Positive: one implementation, verified against a brute-force minute scan in a property test (`cron.test.ts`, "agrees with a brute-force minute scan (property)"), plus explicit OR/AND tests.
- Positive: UTC eliminates DST ambiguity for the first release; the UI labels times as UTC.
- Negative: users wanting "09:00 Europe/Berlin" must compute the UTC offset and accept a one-hour shift across DST until RY-103, which will define skipped-hour and repeated-hour behaviour explicitly.
- Negative: no `L`, `W`, `#` or seconds. They can be added without breaking existing expressions.
- Rejected: option 1 libraries differ on OR semantics and step parsing and would need wrapping to produce path-addressed validation messages anyway; option 2 makes behaviour depend on the server's TZ setting.
