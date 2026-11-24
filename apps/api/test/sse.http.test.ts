import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from '../src/db/pool.js';
import { Runner } from '../src/runner/runner.js';
import {
  createProject,
  createRunVia,
  freshDatabase,
  register,
  silentLogger,
  testApp,
  testConfig,
  type Session,
} from './helpers.js';

let pool: Pool;
let app: FastifyInstance;
let session: Session;
let projectId: string;
let base: string;

beforeAll(async () => {
  pool = await freshDatabase();
  app = await testApp(pool);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  session = await register(app);
  projectId = await createProject(app, session);
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

interface SseEvent {
  event: string;
  id?: string;
  data: string;
}

async function readEvents(url: string, headers: Record<string, string> = {}): Promise<SseEvent[]> {
  const res = await fetch(url, { headers: { cookie: session.cookie, ...headers } });
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const text = await res.text();
  return text
    .split('\n\n')
    .filter((block) => block.includes('event:'))
    .map((block) => {
      const fields = Object.fromEntries(
        block
          .split('\n')
          .filter((line) => !line.startsWith(':') && line.includes(':'))
          .map((line) => [
            line.slice(0, line.indexOf(':')),
            line.slice(line.indexOf(':') + 1).trim(),
          ]),
      );
      return { event: fields.event as string, id: fields.id, data: fields.data as string };
    });
}

describe('log streaming over SSE', () => {
  it('streams live output while the job runs and ends when it finishes', async () => {
    const res = await createRunVia(
      app,
      session,
      projectId,
      `name: live
jobs:
  talk:
    steps:
      - run: for i in 1 2 3; do echo "line $i"; sleep 0.3; done
`,
    );
    const run = res.json().data;
    const job = run.jobs[0];
    const streamPromise = readEvents(`${base}/api/runs/${run.id}/jobs/${job.id}/logs/stream`);
    await new Promise((r) => setTimeout(r, 200));
    const runner = new Runner({
      pool,
      logger: silentLogger,
      config: testConfig(),
      name: 'sse-runner',
    });
    await runner.runOnce();
    const events = await streamPromise;
    const logs = events.filter((e) => e.event === 'log');
    const output = logs.map((e) => (JSON.parse(e.data) as { content: string }).content).join('');
    expect(output).toContain('line 1');
    expect(output).toContain('line 3');
    expect(logs.map((e) => Number(e.id))).toEqual(logs.map((_, i) => i + 1));
    const statuses = events
      .filter((e) => e.event === 'status')
      .map((e) => JSON.parse(e.data).status);
    expect(statuses[0]).toBe('queued');
    expect(statuses).toContain('succeeded');
    expect(events.at(-1)?.event).toBe('end');
  });

  it('replays finished jobs and resumes after Last-Event-ID', async () => {
    const res = await createRunVia(
      app,
      session,
      projectId,
      `name: done
jobs:
  quick:
    steps: [echo one, echo two]
`,
    );
    const run = res.json().data;
    await new Runner({
      pool,
      logger: silentLogger,
      config: testConfig(),
      name: 'sse-runner-2',
    }).runOnce();
    const url = `${base}/api/runs/${run.id}/jobs/${run.jobs[0].id}/logs/stream`;
    const all = (await readEvents(url)).filter((e) => e.event === 'log');
    expect(all.length).toBeGreaterThan(2);
    const resumed = (await readEvents(url, { 'last-event-id': all[1]?.id as string })).filter(
      (e) => e.event === 'log',
    );
    expect(resumed.map((e) => e.id)).toEqual(all.slice(2).map((e) => e.id));

    const json = await app.inject({
      method: 'GET',
      url: `/api/runs/${run.id}/jobs/${run.jobs[0].id}/logs?after=1&limit=2`,
      headers: { cookie: session.cookie },
    });
    expect(json.json().data).toHaveLength(2);
    expect(json.json().meta).toMatchObject({ lastSeq: 3, jobStatus: 'succeeded', complete: false });
  });

  it('rejects unauthenticated stream requests', async () => {
    const res = await fetch(
      `${base}/api/runs/00000000-0000-4000-8000-000000000000/jobs/00000000-0000-4000-8000-000000000000/logs/stream`,
    );
    expect(res.status).toBe(401);
  });
});
