import { isTerminal, type JobStatus } from '@railyard/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { guard, principalOf } from '../../http/auth-hooks.js';
import type { AppContext } from '../../http/context.js';
import { ok } from '../../http/envelope.js';
import { notFound } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { findJobInOrganization } from '../runs/run.repository.js';
import { listChunks } from './log.repository.js';
import { streamJobLogs } from './sse.js';

const params = z.object({ id: z.string().uuid(), jobId: z.string().uuid() });
const query = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
});

export function registerLogRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/runs/:id/jobs/:jobId/logs', { preHandler: guard('run:read') }, async (request) => {
    const { id, jobId } = parse(params, request.params);
    const { after, limit } = parse(query, request.query);
    const job = await findJobInOrganization(
      ctx.pool,
      principalOf(request).organizationId,
      id,
      jobId,
    );
    if (!job) throw notFound('Job');
    const chunks = await listChunks(ctx.pool, jobId, after, limit);
    const lastSeq = chunks.length > 0 ? (chunks[chunks.length - 1] as { seq: number }).seq : after;
    return ok(chunks, {
      lastSeq,
      jobStatus: job.status,
      complete: isTerminal(job.status as JobStatus) && chunks.length < limit,
    });
  });

  app.get(
    '/api/runs/:id/jobs/:jobId/logs/stream',
    { preHandler: guard('run:read') },
    async (request, reply) => {
      const { id, jobId } = parse(params, request.params);
      const { after } = parse(query, request.query);
      const job = await findJobInOrganization(
        ctx.pool,
        principalOf(request).organizationId,
        id,
        jobId,
      );
      if (!job) throw notFound('Job');
      const lastEventId = Number(request.headers['last-event-id']);
      const resumeFrom = Number.isInteger(lastEventId) && lastEventId > 0 ? lastEventId : after;
      await streamJobLogs({
        ctx,
        request,
        reply,
        jobId,
        initialStatus: job.status,
        afterSeq: resumeFrom,
      });
    },
  );
}
