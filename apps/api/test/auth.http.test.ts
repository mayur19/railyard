import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from '../src/db/pool.js';
import {
  authed,
  cookiesFrom,
  freshDatabase,
  PASSWORD,
  register,
  testApp,
  uniqueSlug,
} from './helpers.js';

let pool: Pool;
let app: FastifyInstance;

beforeAll(async () => {
  pool = await freshDatabase();
  app = await testApp(pool, { LOGIN_IP_RATE_LIMIT: '1000', REGISTER_RATE_LIMIT: '100' });
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

const login = (email: string, password: string, ip = '10.1.1.1', target = app) =>
  target.inject({
    method: 'POST',
    url: '/api/auth/login',
    remoteAddress: ip,
    payload: { email, password },
  });

describe('registration', () => {
  it('creates an organization owner, session cookies and an audit entry', async () => {
    const session = await register(app);
    expect(session.body.data.role).toBe('owner');
    expect(session.cookie).toContain('ry_session=');
    expect(session.cookie).toContain('ry_csrf=');
    const audit = await pool.query(
      "SELECT action FROM audit_logs WHERE action = 'auth.registered'",
    );
    expect(audit.rowCount).toBeGreaterThan(0);
    const sessions = await pool.query('SELECT id FROM sessions');
    expect(sessions.rows.every((row: { id: string }) => !session.cookie.includes(row.id))).toBe(
      true,
    );
  });

  it('does not reveal whether an email or slug already exists', async () => {
    const email = `${uniqueSlug('dup')}@example.com`;
    const first = await register(app, email);
    const dupEmail = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        organizationName: 'Other',
        organizationSlug: uniqueSlug(),
        name: 'X',
        email,
        password: PASSWORD,
      },
    });
    const dupSlug = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        organizationName: 'Other',
        organizationSlug: (
          await pool.query('SELECT slug FROM organizations WHERE id = $1', [
            first.body.data.organization.id,
          ])
        ).rows[0].slug,
        name: 'X',
        email: `${uniqueSlug('fresh')}@example.com`,
        password: PASSWORD,
      },
    });
    expect(dupEmail.statusCode).toBe(409);
    expect(dupSlug.statusCode).toBe(409);
    expect(dupEmail.json().error.message).toBe(dupSlug.json().error.message);
    expect(dupEmail.json().error.message).not.toMatch(/email/i);
  });

  it('rejects invalid input with field details', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'nope' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
    expect(res.json().error.details.length).toBeGreaterThan(1);
  });

  it('rate-limits registrations per IP', async () => {
    const limited = await testApp(pool, { REGISTER_RATE_LIMIT: '2' });
    await register(limited, undefined, '10.9.9.9');
    await register(limited, undefined, '10.9.9.9');
    const res = await limited.inject({
      method: 'POST',
      url: '/api/auth/register',
      remoteAddress: '10.9.9.9',
      payload: {},
    });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    await limited.close();
  });
});

describe('login, me and logout', () => {
  it('logs in, returns the principal and logs out', async () => {
    const email = `${uniqueSlug('login')}@example.com`;
    await register(app, email);
    const res = await login(email.toUpperCase(), PASSWORD);
    expect(res.statusCode).toBe(200);
    const csrf = res.json().data.csrfToken as string;
    const cookie = cookiesFrom(res);
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.json().data.user.email).toBe(email);
    const noCsrf = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json().error.code).toBe('CSRF_FAILED');
    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie, 'x-csrf-token': csrf },
    });
    expect(out.statusCode).toBe(204);
    const after = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });

  it('rejects bad credentials identically for unknown users', async () => {
    const email = `${uniqueSlug('bad')}@example.com`;
    await register(app, email);
    const wrong = await login(email, 'wrong-password-123');
    const unknown = await login('nobody@example.com', 'wrong-password-123');
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error).toEqual(unknown.json().error);
  });

  it('rejects garbage session cookies and wrong csrf tokens', async () => {
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: 'ry_session=garbage' },
    });
    expect(me.statusCode).toBe(401);
    const session = await register(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: session.cookie, 'x-csrf-token': 'nope' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('applies progressive per-email backoff across different IPs', async () => {
    const limited = await testApp(pool, {
      LOGIN_EMAIL_FREE_ATTEMPTS: '2',
      LOGIN_BACKOFF_BASE_SECONDS: '30',
    });
    const email = `${uniqueSlug('stuff')}@example.com`;
    await register(limited, email);
    expect((await login(email, 'bad-password-1', '10.2.0.1', limited)).statusCode).toBe(401);
    expect((await login(email, 'bad-password-2', '10.2.0.2', limited)).statusCode).toBe(401);
    expect((await login(email, 'bad-password-3', '10.2.0.3', limited)).statusCode).toBe(401);
    const blocked = await login(email, PASSWORD, '10.2.0.4', limited);
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    await limited.close();
  });

  it('limits all attempts from one IP to catch password spraying', async () => {
    const limited = await testApp(pool, { LOGIN_IP_RATE_LIMIT: '3' });
    const results = [];
    for (let i = 0; i < 4; i += 1)
      results.push(
        (await login(`victim${i}@example.com`, 'Winter2026!!!', '10.3.0.1', limited)).statusCode,
      );
    expect(results).toEqual([401, 401, 401, 429]);
    expect(
      (await login('victim9@example.com', 'Winter2026!!!', '10.3.0.2', limited)).statusCode,
    ).toBe(401);
    await limited.close();
  });

  it('lets only the free attempts through when bad logins arrive in parallel', async () => {
    const limited = await testApp(pool, {
      LOGIN_EMAIL_FREE_ATTEMPTS: '2',
      LOGIN_BACKOFF_BASE_SECONDS: '60',
    });
    const email = `${uniqueSlug('burst')}@example.com`;
    await register(limited, email);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        login(email, `bad-password-${i}`, `10.5.0.${i + 1}`, limited),
      ),
    );
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 401)).toHaveLength(3);
    expect(codes.filter((c) => c === 429)).toHaveLength(7);
    await limited.close();
  });

  it('caps distinct emails per IP and treats IPv6 /64 neighbours as one client', async () => {
    const limited = await testApp(pool, { LOGIN_MAX_EMAILS_PER_IP: '2' });
    expect(
      (await login('a@example.com', 'x-password-123', '2001:db8:1:2::10', limited)).statusCode,
    ).toBe(401);
    expect(
      (await login('b@example.com', 'x-password-123', '2001:db8:1:2::11', limited)).statusCode,
    ).toBe(401);
    expect(
      (await login('c@example.com', 'x-password-123', '2001:db8:1:2::12', limited)).statusCode,
    ).toBe(429);
    expect(
      (await login('c@example.com', 'x-password-123', '2001:db8:1:3::12', limited)).statusCode,
    ).toBe(401);
    await limited.close();
  });

  it('resets the email backoff after a successful login', async () => {
    const limited = await testApp(pool, { LOGIN_EMAIL_FREE_ATTEMPTS: '2' });
    const email = `${uniqueSlug('reset')}@example.com`;
    await register(limited, email);
    await login(email, 'bad-password-1', '10.4.0.1', limited);
    expect((await login(email, PASSWORD, '10.4.0.1', limited)).statusCode).toBe(200);
    await login(email, 'bad-password-2', '10.4.0.1', limited);
    expect((await login(email, PASSWORD, '10.4.0.1', limited)).statusCode).toBe(200);
    await limited.close();
  });
});

describe('RBAC', () => {
  it('forbids viewers from creating projects', async () => {
    const owner = await register(app);
    await pool.query("UPDATE memberships SET role = 'viewer' WHERE user_id = $1", [
      owner.body.data.user.id,
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authed(owner),
      payload: { name: 'X', slug: uniqueSlug('p'), repositoryPath: '/srv/x.git' },
    });
    expect(res.statusCode).toBe(403);
    const list = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { cookie: owner.cookie },
    });
    expect(list.statusCode).toBe(200);
  });
});
