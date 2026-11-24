import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from '../src/db/pool.js';
import { PENDING_ROUTES } from '../src/modules/pending/pending.routes.js';
import {
  authed,
  createProject,
  createRunVia,
  freshDatabase,
  register,
  SIMPLE_PIPELINE,
  testApp,
  type Session,
} from './helpers.js';

let pool: Pool;
let app: FastifyInstance;
let session: Session;
let projectId: string;

beforeAll(async () => {
  pool = await freshDatabase();
  app = await testApp(pool);
  session = await register(app);
  projectId = await createProject(app, session);
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('health', () => {
  it('reports liveness and readiness', async () => {
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.json().data.status).toBe('ok');
    expect(health.headers['x-request-id']).toBeDefined();
    const ready = await app.inject({
      method: 'GET',
      url: '/api/ready',
      headers: { 'x-request-id': 'trace-12345678' },
    });
    expect(ready.json().data).toMatchObject({ status: 'ready', database: 'up' });
    expect(ready.headers['x-request-id']).toBe('trace-12345678');
  });
});

describe('projects', () => {
  it('lists and fetches projects within the organization', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { cookie: session.cookie },
    });
    expect(list.json().data).toHaveLength(1);
    const one = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}`,
      headers: { cookie: session.cookie },
    });
    expect(one.json().data).toMatchObject({ id: projectId, defaultBranch: 'main', lastRun: null });
  });

  it('rejects duplicate slugs and relative repository paths', async () => {
    const slug = 'dup-slug';
    await createProject(app, session, slug);
    const dup = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authed(session),
      payload: { name: 'Again', slug, repositoryPath: '/x.git' },
    });
    expect(dup.statusCode).toBe(409);
    const rel = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authed(session),
      payload: { name: 'Rel', slug: 'rel-path', repositoryPath: 'x.git' },
    });
    expect(rel.statusCode).toBe(400);
  });

  it('isolates tenants', async () => {
    const other = await register(app);
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}`,
      headers: { cookie: other.cookie },
    });
    expect(res.statusCode).toBe(404);
    const runs = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/runs`,
      headers: { cookie: other.cookie },
    });
    expect(runs.statusCode).toBe(404);
    const create = await createRunVia(app, other, projectId, SIMPLE_PIPELINE);
    expect(create.statusCode).toBe(404);
  });
});

describe('pipeline validation endpoint', () => {
  it('returns issues with line numbers for invalid YAML', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/pipelines/validate',
      headers: authed(session),
      payload: { yaml: 'name: x\njobs:\n  a:\n    needs: [ghost]\n    steps: [echo]\n' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.valid).toBe(false);
    expect(res.json().data.issues[0]).toMatchObject({
      code: 'unknown_job',
      path: 'jobs.a.needs[0]',
      line: 4,
    });
  });

  it('returns a plan for valid YAML and honours the context', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/pipelines/validate',
      headers: authed(session),
      payload: { yaml: SIMPLE_PIPELINE, context: { branch: 'dev', event: 'push' } },
    });
    const data = res.json().data;
    expect(data.valid).toBe(true);
    expect(data.plan.jobs.map((j: { key: string }) => j.key)).toEqual([
      'build',
      'test[n=1]',
      'test[n=2]',
    ]);
    expect(data.plan.levels).toEqual([['build'], ['test[n=1]', 'test[n=2]']]);
  });

  it('reports plans that exceed limits as invalid', async () => {
    const values = Array.from({ length: 16 }, (_, i) => i).join(', ');
    const jobs = Array.from(
      { length: 5 },
      (_, i) =>
        `  j${i}:\n    matrix:\n      a: [${values}]\n      b: [${values}]\n    steps: [x]\n`,
    ).join('');
    const res = await app.inject({
      method: 'POST',
      url: '/api/pipelines/validate',
      headers: authed(session),
      payload: { yaml: `name: big\njobs:\n${jobs}` },
    });
    expect(res.json().data.valid).toBe(false);
    expect(res.json().data.issues.at(-1).code).toBe('plan_too_large');
  });
});

describe('runs', () => {
  it('persists the plan as jobs and steps with initial statuses', async () => {
    const res = await createRunVia(app, session, projectId, SIMPLE_PIPELINE);
    expect(res.statusCode).toBe(201);
    const run = res.json().data;
    expect(run).toMatchObject({
      number: 1,
      status: 'queued',
      pipelineName: 'simple',
      branch: 'main',
    });
    const statuses = Object.fromEntries(
      run.jobs.map((j: { key: string; status: string }) => [j.key, j.status]),
    );
    expect(statuses).toEqual({ build: 'queued', 'test[n=1]': 'blocked', 'test[n=2]': 'blocked' });
    expect(run.jobs[1].needs).toEqual(['build']);
    expect(run.jobs[1].steps[0]).toMatchObject({ position: 0, status: 'pending' });
    expect(run.jobCounts).toEqual({ queued: 1, blocked: 2 });
    const step = await pool.query(
      "SELECT script FROM job_steps s JOIN jobs j ON j.id = s.job_id WHERE j.key = 'test[n=2]'",
    );
    expect(step.rows[0].script).toBe('echo "test 2"');
  });

  it('numbers runs sequentially under concurrency', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => createRunVia(app, session, projectId, SIMPLE_PIPELINE)),
    );
    const numbers = results.map((r) => r.json().data.number).sort((a: number, b: number) => a - b);
    expect(new Set(numbers).size).toBe(5);
  });

  it('paginates the run list with a cursor', async () => {
    const first = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/runs?limit=2`,
      headers: { cookie: session.cookie },
    });
    const page1 = first.json();
    expect(page1.data).toHaveLength(2);
    expect(page1.meta.nextCursor).toBe(String(page1.data[1].number));
    const second = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/runs?limit=2&cursor=${page1.meta.nextCursor}`,
      headers: { cookie: session.cookie },
    });
    expect(second.json().data[0].number).toBeLessThan(page1.data[1].number);
  });

  it('rejects invalid pipelines and empty plans with 422', async () => {
    const invalid = await createRunVia(app, session, projectId, 'name: x\njobs: {}\n');
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error.code).toBe('PIPELINE_INVALID');
    expect(invalid.json().error.details.issues[0].code).toBe('empty');
    const empty = await createRunVia(
      app,
      session,
      projectId,
      'name: x\njobs:\n  a:\n    if: "branch == \'prod\'"\n    steps: [x]\n',
    );
    expect(empty.statusCode).toBe(422);
    expect(empty.json().error.code).toBe('EMPTY_PLAN');
  });

  it('returns 404 for unknown runs and jobs', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/runs/${id}`,
          headers: { cookie: session.cookie },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/runs/${id}/jobs/${id}/logs`,
          headers: { cookie: session.cookie },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/runs/not-a-uuid`,
          headers: { cookie: session.cookie },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/runs` });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      data: null,
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
  });
});

describe('pending routes and errors', () => {
  it('answers every planned route with 501 and its ticket', async () => {
    for (const route of PENDING_ROUTES) {
      const url = route.url.replace(/:[a-zA-Z]+/g, '00000000-0000-4000-8000-000000000000');
      const res = await app.inject({ method: route.method, url, headers: authed(session) });
      expect(res.statusCode, `${route.method} ${route.url}`).toBe(501);
      expect(res.json().error).toMatchObject({
        code: 'NOT_IMPLEMENTED',
        details: { ticket: route.ticket },
      });
    }
  });

  it('still authenticates pending routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/runners' });
    expect(res.statusCode).toBe(401);
  });

  it('returns enveloped 404s and handles malformed JSON', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{bad',
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('BAD_REQUEST');
  });
});
