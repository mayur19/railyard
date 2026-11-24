import { createProjectSchema, uuidParam } from '@railyard/shared';
import type { FastifyInstance } from 'fastify';
import { withTransaction } from '../../db/pool.js';
import { guard, principalOf } from '../../http/auth-hooks.js';
import type { AppContext } from '../../http/context.js';
import { ok } from '../../http/envelope.js';
import { conflict, notFound } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { writeAudit } from '../audit/audit.repository.js';
import { findProject, insertProject, listProjects } from './project.repository.js';

export function registerProjectRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/projects', { preHandler: guard('project:read') }, async (request) => {
    const principal = principalOf(request);
    return ok(await listProjects(ctx.pool, principal.organizationId));
  });

  app.get('/api/projects/:id', { preHandler: guard('project:read') }, async (request) => {
    const { id } = parse(uuidParam, request.params);
    const project = await findProject(ctx.pool, principalOf(request).organizationId, id);
    if (!project) throw notFound('Project');
    return ok(project);
  });

  app.post('/api/projects', { preHandler: guard('project:write') }, async (request, reply) => {
    const principal = principalOf(request);
    const input = parse(createProjectSchema, request.body);
    try {
      const project = await withTransaction(ctx.pool, async (tx) => {
        const id = await insertProject(tx, principal.organizationId, principal.userId, input);
        await writeAudit(tx, {
          organizationId: principal.organizationId,
          actorUserId: principal.userId,
          action: 'project.created',
          targetType: 'project',
          targetId: id,
          metadata: { slug: input.slug },
          requestId: request.id,
        });
        return findProject(tx, principal.organizationId, id);
      });
      return reply.status(201).send(ok(project));
    } catch (err) {
      if ((err as { code?: string }).code === '23505')
        throw conflict(`Project slug '${input.slug}' is already in use`);
      throw err;
    }
  });
}
