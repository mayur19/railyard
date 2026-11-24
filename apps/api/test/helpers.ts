import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { loadConfig, type AppConfig } from '../src/config/env.js';
import { migrate, resetSchema } from '../src/db/migrate.js';
import { createPool, type Pool } from '../src/db/pool.js';
import { buildApp } from '../src/http/app.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  `postgres://${encodeURIComponent(os.userInfo().username)}@localhost/railyard_test?host=/tmp`;

export const silentLogger = pino({ level: 'silent' });

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    SESSION_SECRET: 'test-session-secret-that-is-long-enough-123',
    LOG_LEVEL: 'silent',
    WORKSPACE_ROOT: path.join(os.tmpdir(), 'railyard-test-workspaces'),
    RUNNER_LEASE_SECONDS: '5',
    RUNNER_POLL_MS: '50',
    ...overrides,
  });
}

/** Fresh schema per test file (files run sequentially; see vitest.config.ts). */
export async function freshDatabase(): Promise<Pool> {
  const pool = createPool(TEST_DATABASE_URL, 8);
  await resetSchema(pool, 'test');
  await migrate(pool);
  return pool;
}

export async function testApp(
  pool: Pool,
  overrides: Record<string, string> = {},
): Promise<FastifyInstance> {
  const app = await buildApp({ config: testConfig(overrides), pool, logger: silentLogger });
  await app.ready();
  return app;
}

export interface Session {
  readonly cookie: string;
  readonly csrf: string;
  readonly body: {
    data: { user: { id: string }; organization: { id: string }; role: string; csrfToken: string };
  };
}

export function cookiesFrom(res: LightMyRequestResponse): string {
  return res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

let counter = 0;
export function uniqueSlug(prefix = 'org'): string {
  counter += 1;
  return `${prefix}-${process.pid}-${counter}`;
}

export const PASSWORD = 'a-very-long-test-password';

export async function register(
  app: FastifyInstance,
  email?: string,
  ip = '10.0.0.1',
): Promise<Session> {
  const slug = uniqueSlug();
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    remoteAddress: ip,
    payload: {
      organizationName: `Org ${slug}`,
      organizationSlug: slug,
      name: 'Tester',
      email: email ?? `${slug}@example.com`,
      password: PASSWORD,
    },
  });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  const body = res.json() as Session['body'];
  return { cookie: cookiesFrom(res), csrf: body.data.csrfToken, body };
}

export function authed(session: Session) {
  return { cookie: session.cookie, 'x-csrf-token': session.csrf };
}

export const SIMPLE_PIPELINE = `name: simple
stages: [build, test]
jobs:
  build:
    stage: build
    steps:
      - echo building
  test:
    stage: test
    matrix:
      n: [1, 2]
    steps:
      - echo "test \${{ matrix.n }}"
`;

export async function createProject(
  app: FastifyInstance,
  session: Session,
  slug = uniqueSlug('proj'),
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: authed(session),
    payload: { name: 'Project', slug, repositoryPath: '/srv/git/project.git' },
  });
  if (res.statusCode !== 201) throw new Error(`project failed: ${res.body}`);
  return (res.json() as { data: { id: string } }).data.id;
}

export async function createRunVia(
  app: FastifyInstance,
  session: Session,
  projectId: string,
  yaml: string,
  branch = 'main',
) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/runs`,
    headers: authed(session),
    payload: { yaml, branch },
  });
  return res;
}
