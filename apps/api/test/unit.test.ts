import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseTrustProxy } from '../src/config/env.js';
import { toFastifyTrustProxy } from '../src/http/app.js';
import { normaliseIp } from '../src/http/client-ip.js';
import {
  BoundedStore,
  createBackoffLimiter,
  createDistinctKeyLimiter,
  createRateLimiter,
} from '../src/http/rate-limit.js';
import { hashPassword, verifyPassword } from '../src/security/password.js';
import { hmacToken, randomToken } from '../src/security/tokens.js';
import { buildStepEnv, resolveStepDirectory } from '../src/runner/workspace.js';

const base = { DATABASE_URL: 'postgres://x/y', SESSION_SECRET: 'x'.repeat(32) };

describe('config', () => {
  it('applies defaults', () => {
    const config = loadConfig(base);
    expect(config.API_PORT).toBe(4105);
    expect(config.TRUST_PROXY).toBe(false);
    expect(config.COOKIE_SECURE).toBe(false);
  });

  it('lists every problem', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ DATABASE_URL: 'x', SESSION_SECRET: 'short' })).toThrow(
      /SESSION_SECRET/,
    );
  });

  it('requires secure cookies and an explicit TRUST_PROXY in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'true' })).toThrow(
      /TRUST_PROXY must be set/,
    );
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', TRUST_PROXY: 'false' })).toThrow(
      /COOKIE_SECURE/,
    );
    const prod = loadConfig({
      ...base,
      NODE_ENV: 'production',
      COOKIE_SECURE: 'true',
      TRUST_PROXY: '127.0.0.1',
    });
    expect(prod.TRUST_PROXY).toEqual(['127.0.0.1']);
    expect(
      loadConfig({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'true', TRUST_PROXY: 'false' })
        .TRUST_PROXY,
    ).toBe(false);
  });

  it('parses TRUST_PROXY as false, hop count or address list and rejects true', () => {
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('127.0.0.1, 10.0.0.0/8')).toEqual(['127.0.0.1', '10.0.0.0/8']);
    expect(parseTrustProxy('::1')).toEqual(['::1']);
    expect(parseTrustProxy('true')).toBeNull();
    expect(parseTrustProxy('*')).toBeNull();
    expect(() => loadConfig({ ...base, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
    expect(loadConfig({ ...base, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
  });

  it('maps hop counts to a hop-limited trust function', () => {
    expect(toFastifyTrustProxy(false)).toBe(false);
    expect(toFastifyTrustProxy(['127.0.0.1'])).toEqual(['127.0.0.1']);
    const fn = toFastifyTrustProxy(1) as (a: string, hop: number) => boolean;
    expect(fn('1.2.3.4', 0)).toBe(true);
    expect(fn('1.2.3.4', 1)).toBe(false);
  });
});

describe('fixed window rate limiter', () => {
  it('blocks after the limit until the window resets', () => {
    const limiter = createRateLimiter(2, 60);
    expect(limiter.hit('k', 0)).toBe(0);
    expect(limiter.hit('k', 1000)).toBe(0);
    expect(limiter.hit('k', 2000)).toBe(58);
    expect(limiter.hit('k', 61_000)).toBe(0);
    limiter.reset('k');
    expect(limiter.hit('k', 61_500)).toBe(0);
  });

  it('sweeps expired windows before evicting anything active', () => {
    const evicted: string[] = [];
    const limiter = createRateLimiter(1, 60, { maxKeys: 2, onEvict: (i) => evicted.push(i.key) });
    limiter.hit('a', 0);
    limiter.hit('a', 0);
    limiter.hit('b', 50_000);
    limiter.hit('c', 61_000); // 'a' expired at 60s and is swept
    expect(evicted).toEqual([]);
    expect(limiter.hit('b', 61_500)).toBeGreaterThan(0);
  });

  it('evicts the active entry with the least time left and reports it', () => {
    const evicted: { key: string; remainingMs: number }[] = [];
    const limiter = createRateLimiter(1, 60, { maxKeys: 2, onEvict: (i) => evicted.push(i) });
    limiter.hit('old', 0);
    limiter.hit('new', 30_000);
    expect(limiter.hit('fresh', 31_000)).toBe(0); // new keys are always admitted
    expect(evicted).toEqual([{ key: 'old', remainingMs: 29_000, store: 'fixed-window' }]);
    expect(limiter.hit('new', 31_000)).toBeGreaterThan(0);
  });
});

describe('bounded store sweep cursor', () => {
  it('resumes sweeping across calls and covers the whole map', () => {
    const store = new BoundedStore<number>({
      name: 't',
      maxKeys: 3,
      isExpired: (v, now) => v <= now,
      remainingMs: (v, now) => v - now,
    });
    store.set('a', 1000, 0);
    store.set('b', 5, 0);
    store.set('c', 1000, 0);
    store.set('d', 1000, 10); // 'b' expired: swept, no eviction
    expect(store.get('b')).toBeUndefined();
    expect(store.size).toBe(3);
    store.set('e', 1000, 20); // nothing expired: least remaining evicted
    expect(store.size).toBe(3);
  });
});

describe('progressive backoff limiter', () => {
  const opts = { freeAttempts: 3, baseSeconds: 10, maxSeconds: 60, forgetAfterSeconds: 3600 };

  it('reserves attempts synchronously and doubles the lockout up to the cap', () => {
    const limiter = createBackoffLimiter(opts);
    expect([1, 2, 3].map(() => limiter.reserve('e', 0))).toEqual([0, 0, 0]);
    expect(limiter.reserve('e', 0)).toBe(0); // 4th attempt proceeds, locks for 10s afterwards
    expect(limiter.reserve('e', 0)).toBe(10);
    expect(limiter.check('e', 5000)).toBe(5);
    expect(limiter.reserve('e', 10_000)).toBe(0);
    expect(limiter.check('e', 10_000)).toBe(20);
    limiter.reserve('e', 30_000);
    expect(limiter.check('e', 30_000)).toBe(40);
    limiter.reserve('e', 70_000);
    expect(limiter.check('e', 70_000)).toBe(60);
  });

  it('forgets old failures and resets on success', () => {
    const limiter = createBackoffLimiter(opts);
    for (let i = 0; i < 4; i += 1) limiter.reserve('e', 0);
    expect(limiter.check('e', 1000)).toBeGreaterThan(0);
    expect(limiter.check('e', 3_700_000)).toBe(0);
    limiter.reserve('x', 0);
    limiter.reset('x');
    expect(limiter.check('x', 0)).toBe(0);
  });

  it('evicts unlocked entries before active lockouts when full', () => {
    const evicted: string[] = [];
    const limiter = createBackoffLimiter({
      ...opts,
      freeAttempts: 1,
      maxKeys: 2,
      onEvict: (i) => evicted.push(i.key),
    });
    limiter.reserve('locked', 0);
    limiter.reserve('locked', 0); // locked for 10s
    limiter.reserve('unlocked', 0);
    limiter.reserve('another', 1000);
    expect(evicted).toEqual(['unlocked']);
    expect(limiter.check('locked', 1000)).toBeGreaterThan(0);
  });
});

describe('distinct email cap per IP', () => {
  it('limits fresh emails per IP but allows retrying known ones', () => {
    const limiter = createDistinctKeyLimiter(2, 60);
    expect(limiter.admit('1.2.3.4', 'a', 0)).toBe(0);
    expect(limiter.admit('1.2.3.4', 'b', 0)).toBe(0);
    expect(limiter.admit('1.2.3.4', 'a', 0)).toBe(0);
    expect(limiter.admit('1.2.3.4', 'c', 1000)).toBe(59);
    expect(limiter.admit('5.6.7.8', 'c', 1000)).toBe(0);
    expect(limiter.admit('1.2.3.4', 'c', 61_000)).toBe(0);
  });
});

describe('normaliseIp', () => {
  it.each([
    ['1.2.3.4', '1.2.3.4'],
    ['::ffff:10.0.0.7', '10.0.0.7'],
    ['::FFFF:10.0.0.7', '10.0.0.7'],
    ['2001:db8:abcd:12:1:2:3:4', '2001:db8:abcd:12::/64'],
    ['2001:db8:abcd:12::99', '2001:db8:abcd:12::/64'],
    ['2001:0db8:00ab::', '2001:db8:ab:0::/64'],
    ['[2001:db8::1]', '2001:db8:0:0::/64'],
    ['fe80::1%en0', 'fe80:0:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    ['64:ff9b::1.2.3.4', '64:ff9b:0:0::/64'],
    ['not-an-ip', 'not-an-ip'],
    [undefined, 'unknown'],
  ])('%s -> %s', (raw, expected) => {
    expect(normaliseIp(raw)).toBe(expected);
  });
});

describe('password hashing and tokens', () => {
  it('verifies correct passwords only', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$whatever')).toBe(false);
  });

  it('creates random tokens and keyed hashes', () => {
    expect(randomToken()).not.toBe(randomToken());
    expect(hmacToken('k', 't')).toBe(hmacToken('k', 't'));
    expect(hmacToken('k', 't')).not.toBe(hmacToken('k2', 't'));
  });
});

describe('workspace helpers', () => {
  it('builds an isolated environment without runner secrets', () => {
    process.env.SUPER_SECRET_TEST = 'leak';
    const env = buildStepEnv('/w', { A: '1' }, { B: '2' });
    expect(env).toMatchObject({ HOME: '/w', A: '1', B: '2', RAILYARD_WORKSPACE: '/w' });
    expect(env.SUPER_SECRET_TEST).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('refuses working directories outside the workspace', async () => {
    await expect(resolveStepDirectory('/tmp/ws-root', '../etc')).rejects.toThrow(/escapes/);
    expect(await resolveStepDirectory('/tmp', null)).toBe('/tmp');
  });
});
