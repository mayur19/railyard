import { createRunSchema, paginationSchema, uuidParam } from '@railyard/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { guard, principalOf } from '../../http/auth-hooks.js';
import type { AppContext } from '../../http/context.js';
import { ok } from '../../http/envelope.js';
import { notFound } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { findProject } from '../projects/project.repository.js';
import { findRun, listRuns } from './run.repository.js';
import { createRun } from './run.service.js';

const cursorSchema = paginationSchema.extend({
  cursor: z.coerce.number().int().positive().optional(),
});

export function registerRunRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post(
    '/api/projects/:id/runs',
    { preHandler: guard('run:create') },
    async (request, reply) => {
      const { id } = parse(uuidParam, request.params);
      const input = parse(createRunSchema, request.body);
      const run = await createRun(ctx.pool, principalOf(request), id, input, request.id);
      return reply.status(201).send(ok(run));
    },
  );

  app.get('/api/projects/:id/runs', { preHandler: guard('run:read') }, async (request) => {
    const { id } = parse(uuidParam, request.params);
    const { limit, cursor } = parse(cursorSchema, request.query);
    const principal = principalOf(request);
    if (!(await findProject(ctx.pool, principal.organizationId, id))) throw notFound('Project');
    const runs = await listRuns(ctx.pool, principal.organizationId, id, limit + 1, cursor ?? null);
    const page = runs.slice(0, limit);
    const nextCursor = runs.length > limit ? String(page[page.length - 1]?.number) : null;
    return ok(page, { nextCursor, limit });
  });

  app.get('/api/runs/:id', { preHandler: guard('run:read') }, async (request) => {
    const { id } = parse(uuidParam, request.params);
    const run = await findRun(ctx.pool, principalOf(request).organizationId, id);
    if (!run) throw notFound('Run');
    return ok(run);
  });
}
