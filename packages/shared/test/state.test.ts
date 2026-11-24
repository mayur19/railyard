import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  canTransition,
  deriveRunStatus,
  initialStatus,
  InvalidTransitionError,
  isTerminal,
  outcomeAfterAttempt,
  resolveBlockedJobs,
  type SchedulableJob,
} from '../src/jobs/state.js';

const job = (
  key: string,
  status: SchedulableJob['status'],
  needs: string[] = [],
  extra: Partial<SchedulableJob> = {},
): SchedulableJob => ({
  key,
  status,
  needs,
  when: 'on_success',
  allowFailure: false,
  ...extra,
});

describe('job transitions', () => {
  it('allows the documented lifecycle', () => {
    expect(canTransition('blocked', 'queued')).toBe(true);
    expect(canTransition('queued', 'running')).toBe(true);
    expect(canTransition('running', 'succeeded')).toBe(true);
    expect(canTransition('running', 'queued')).toBe(true);
  });

  it('rejects moves out of terminal states', () => {
    expect(canTransition('succeeded', 'running')).toBe(false);
    expect(() => assertTransition('failed', 'queued')).toThrow(InvalidTransitionError);
    expect(() => assertTransition('queued', 'running')).not.toThrow();
    expect(isTerminal('skipped')).toBe(true);
    expect(isTerminal('running')).toBe(false);
  });

  it('chooses initial status from dependencies', () => {
    expect(initialStatus([])).toBe('queued');
    expect(initialStatus(['a'])).toBe('blocked');
  });
});

describe('resolveBlockedJobs', () => {
  it('queues dependents when all needs succeed', () => {
    const changes = resolveBlockedJobs([
      job('a', 'succeeded'),
      job('b', 'succeeded'),
      job('c', 'blocked', ['a', 'b']),
    ]);
    expect(changes).toEqual([{ key: 'c', from: 'blocked', to: 'queued' }]);
  });

  it('waits while any dependency is still active', () => {
    expect(resolveBlockedJobs([job('a', 'running'), job('c', 'blocked', ['a'])])).toEqual([]);
  });

  it('propagates skips down a chain in one pass', () => {
    const changes = resolveBlockedJobs([
      job('a', 'failed'),
      job('b', 'blocked', ['a']),
      job('c', 'blocked', ['b']),
      job('d', 'blocked', ['c']),
    ]);
    expect(changes.map((c) => `${c.key}:${c.to}`)).toEqual(['b:skipped', 'c:skipped', 'd:skipped']);
  });

  it('treats allowed failures as satisfied', () => {
    const changes = resolveBlockedJobs([
      job('a', 'failed', [], { allowFailure: true }),
      job('b', 'blocked', ['a']),
    ]);
    expect(changes[0]?.to).toBe('queued');
  });

  it('runs on_failure jobs when any ancestor failed', () => {
    const changes = resolveBlockedJobs([
      job('a', 'timed_out'),
      job('b', 'blocked', ['a']),
      job('notify', 'blocked', ['b'], { when: 'on_failure' }),
    ]);
    expect(changes.map((c) => `${c.key}:${c.to}`)).toEqual(['b:skipped', 'notify:queued']);
  });

  it('skips on_failure jobs when everything passed', () => {
    const changes = resolveBlockedJobs([
      job('a', 'succeeded'),
      job('n', 'blocked', ['a'], { when: 'on_failure' }),
    ]);
    expect(changes[0]?.to).toBe('skipped');
  });

  it('runs always jobs regardless of outcome, and cancels on cancelled deps', () => {
    const changes = resolveBlockedJobs([
      job('a', 'cancelled'),
      job('cleanup', 'blocked', ['a'], { when: 'always' }),
      job('next', 'blocked', ['a']),
    ]);
    expect(changes.map((c) => `${c.key}:${c.to}`)).toEqual(['cleanup:queued', 'next:cancelled']);
  });

  it('ignores unknown dependency keys and does not mutate input', () => {
    const input = [job('b', 'blocked', ['ghost'])];
    const frozen = JSON.stringify(input);
    expect(resolveBlockedJobs(input)[0]?.to).toBe('queued');
    expect(JSON.stringify(input)).toBe(frozen);
  });
});

describe('deriveRunStatus', () => {
  it.each([
    [[], 'succeeded'],
    [[job('a', 'queued')], 'queued'],
    [[job('a', 'blocked'), job('b', 'queued')], 'queued'],
    [[job('a', 'running'), job('b', 'blocked')], 'running'],
    [[job('a', 'succeeded'), job('b', 'queued')], 'running'],
    [[job('a', 'succeeded'), job('b', 'skipped')], 'succeeded'],
    [[job('a', 'failed'), job('b', 'skipped')], 'failed'],
    [[job('a', 'timed_out')], 'failed'],
    [[job('a', 'failed', [], { allowFailure: true })], 'succeeded'],
    [[job('a', 'cancelled'), job('b', 'failed')], 'cancelled'],
  ] as const)('%j -> %s', (jobs, expected) => {
    expect(deriveRunStatus(jobs)).toBe(expected);
  });
});

describe('outcomeAfterAttempt', () => {
  it('retries failures while attempts remain', () => {
    expect(outcomeAfterAttempt('failed', 1, 2)).toEqual({ status: 'queued', retry: true });
    expect(outcomeAfterAttempt('timed_out', 2, 2)).toEqual({ status: 'queued', retry: true });
    expect(outcomeAfterAttempt('failed', 3, 2)).toEqual({ status: 'failed', retry: false });
    expect(outcomeAfterAttempt('succeeded', 1, 2)).toEqual({ status: 'succeeded', retry: false });
    expect(outcomeAfterAttempt('cancelled', 1, 2)).toEqual({ status: 'cancelled', retry: false });
  });
});
