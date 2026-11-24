/**
 * In-memory throttling primitives (per API process). Adequate for a single node. These counters
 * must move to Postgres before running more than one API instance (RY-151); until then
 * docs/operations/deployment.md mandates a single API process.
 *
 * Every store is bounded. When full it first sweeps expired entries with a resumable cursor that
 * eventually covers the whole map; if every entry is still active it evicts the one with the least
 * time left and reports it through `onEvict`, so an attacker filling the store cannot lock out
 * other users (new keys are always admitted) and cannot cheaply erase long lockouts either.
 */

export type EvictionListener = (info: { key: string; remainingMs: number; store: string }) => void;

export interface StoreOptions<V> {
  readonly name: string;
  readonly maxKeys: number;
  readonly isExpired: (value: V, now: number) => boolean;
  readonly remainingMs: (value: V, now: number) => number;
  readonly onEvict?: EvictionListener;
}

/** Bounded map with expiry sweeping and least-remaining-time eviction. */
export class BoundedStore<V> {
  private readonly map = new Map<string, V>();
  private cursor: IterableIterator<string> | null = null;

  constructor(private readonly opts: StoreOptions<V>) {}

  get size(): number {
    return this.map.size;
  }

  get(key: string): V | undefined {
    return this.map.get(key);
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  set(key: string, value: V, now: number): void {
    if (!this.map.has(key) && this.map.size >= this.opts.maxKeys) this.makeRoom(now);
    this.map.set(key, value);
  }

  private makeRoom(now: number): void {
    this.sweep(now);
    if (this.map.size < this.opts.maxKeys) return;
    let victim: string | null = null;
    let least = Number.POSITIVE_INFINITY;
    for (const [key, value] of this.map) {
      const remaining = this.opts.remainingMs(value, now);
      if (remaining < least) {
        least = remaining;
        victim = key;
      }
    }
    if (victim !== null) {
      this.map.delete(victim);
      this.opts.onEvict?.({ key: victim, remainingMs: least, store: this.opts.name });
    }
  }

  /** Visits at most one full cycle of the map, resuming where the previous sweep stopped. */
  private sweep(now: number): void {
    let visited = 0;
    const total = this.map.size;
    while (visited < total && this.map.size >= this.opts.maxKeys) {
      this.cursor ??= this.map.keys();
      const next = this.cursor.next();
      if (next.done) {
        this.cursor = null;
        continue;
      }
      visited += 1;
      const value = this.map.get(next.value);
      if (value !== undefined && this.opts.isExpired(value, now)) this.map.delete(next.value);
    }
  }
}

export interface RateLimiter {
  /** Records a hit; returns 0 when allowed, otherwise seconds until the window resets. */
  hit(key: string, now?: number): number;
  reset(key: string): void;
}

interface Window {
  readonly count: number;
  readonly resetAt: number;
}

/** Fixed-window counter. */
export function createRateLimiter(
  limit: number,
  windowSeconds: number,
  opts: { maxKeys?: number; onEvict?: EvictionListener; name?: string } = {},
): RateLimiter {
  const store = new BoundedStore<Window>({
    name: opts.name ?? 'fixed-window',
    maxKeys: opts.maxKeys ?? 10_000,
    isExpired: (w, now) => w.resetAt <= now,
    remainingMs: (w, now) => Math.max(0, w.resetAt - now),
    ...(opts.onEvict ? { onEvict: opts.onEvict } : {}),
  });
  return {
    hit(key, now = Date.now()) {
      const current = store.get(key);
      if (!current || current.resetAt <= now) {
        store.set(key, { count: 1, resetAt: now + windowSeconds * 1000 }, now);
        return 0;
      }
      const next = { count: current.count + 1, resetAt: current.resetAt };
      store.set(key, next, now);
      return next.count > limit ? Math.ceil((next.resetAt - now) / 1000) : 0;
    },
    reset(key) {
      store.delete(key);
    },
  };
}

export interface BackoffLimiter {
  /** Seconds the key must wait before the next attempt (0 = allowed now). */
  check(key: string, now?: number): number;
  /**
   * Synchronously reserves an attempt: returns the wait in seconds if locked out, otherwise
   * counts the attempt as a failure up front and returns 0. Call before any await and call
   * reset() on success, so parallel requests cannot all pass the check.
   */
  reserve(key: string, now?: number): number;
  reset(key: string): void;
}

export interface BackoffOptions {
  readonly freeAttempts: number;
  readonly baseSeconds: number;
  readonly maxSeconds: number;
  /** Failures are forgotten after this long without a new failure. */
  readonly forgetAfterSeconds?: number;
  readonly maxKeys?: number;
  readonly onEvict?: EvictionListener;
}

interface BackoffState {
  readonly failures: number;
  readonly blockedUntil: number;
  readonly lastFailure: number;
}

/**
 * Progressive backoff per key: the first `freeAttempts` failures are free, then each further
 * failure doubles the lockout (base, 2x base, 4x base ...) up to maxSeconds.
 */
export function createBackoffLimiter(opts: BackoffOptions): BackoffLimiter {
  const forgetMs = (opts.forgetAfterSeconds ?? 24 * 3600) * 1000;
  const store = new BoundedStore<BackoffState>({
    name: 'login-backoff',
    maxKeys: opts.maxKeys ?? 10_000,
    isExpired: (s, now) => s.blockedUntil <= now && now - s.lastFailure > forgetMs,
    remainingMs: (s, now) => Math.max(0, s.blockedUntil - now),
    ...(opts.onEvict ? { onEvict: opts.onEvict } : {}),
  });
  const current = (key: string, now: number): BackoffState | undefined => {
    const entry = store.get(key);
    if (entry && entry.blockedUntil <= now && now - entry.lastFailure > forgetMs) {
      store.delete(key);
      return undefined;
    }
    return entry;
  };
  const check = (key: string, now: number): number => {
    const entry = current(key, now);
    return entry && entry.blockedUntil > now ? Math.ceil((entry.blockedUntil - now) / 1000) : 0;
  };
  return {
    check(key, now = Date.now()) {
      return check(key, now);
    },
    reserve(key, now = Date.now()) {
      const wait = check(key, now);
      if (wait > 0) return wait;
      const failures = (current(key, now)?.failures ?? 0) + 1;
      const over = failures - opts.freeAttempts;
      const lockSeconds =
        over > 0 ? Math.min(opts.maxSeconds, opts.baseSeconds * 2 ** (over - 1)) : 0;
      store.set(key, { failures, blockedUntil: now + lockSeconds * 1000, lastFailure: now }, now);
      return 0;
    },
    reset(key) {
      store.delete(key);
    },
  };
}

export interface DistinctKeyLimiter {
  /** Admits `member` for `owner`; returns seconds to wait when owner exceeded its distinct-member cap. */
  admit(owner: string, member: string, now?: number): number;
}

interface MemberWindow {
  readonly members: ReadonlySet<string>;
  readonly resetAt: number;
}

/**
 * Caps how many distinct members (e.g. email addresses) one owner (a normalised client IP) may
 * introduce per window. Stops one client from flooding the per-email store with fresh keys.
 */
export function createDistinctKeyLimiter(
  maxDistinct: number,
  windowSeconds: number,
  opts: { maxKeys?: number; onEvict?: EvictionListener } = {},
): DistinctKeyLimiter {
  const store = new BoundedStore<MemberWindow>({
    name: 'emails-per-ip',
    maxKeys: opts.maxKeys ?? 10_000,
    isExpired: (w, now) => w.resetAt <= now,
    remainingMs: (w, now) => Math.max(0, w.resetAt - now),
    ...(opts.onEvict ? { onEvict: opts.onEvict } : {}),
  });
  return {
    admit(owner, member, now = Date.now()) {
      const existing = store.get(owner);
      const window =
        existing && existing.resetAt > now
          ? existing
          : { members: new Set<string>(), resetAt: now + windowSeconds * 1000 };
      if (window.members.has(member)) return 0;
      if (window.members.size >= maxDistinct) return Math.ceil((window.resetAt - now) / 1000);
      store.set(
        owner,
        { members: new Set([...window.members, member]), resetAt: window.resetAt },
        now,
      );
      return 0;
    },
  };
}
