import { validatePipelineSchema } from '@railyard/shared';
import type { FastifyInstance } from 'fastify';
import { guard } from '../../http/auth-hooks.js';
import type { AppContext } from '../../http/context.js';
import { ok } from '../../http/envelope.js';
import { parse } from '../../http/validate.js';
import { previewPlan } from '../runs/run.service.js';

export function registerPipelineRoutes(app: FastifyInstance, _ctx: AppContext): void {
  // POST without side effects: validation and planning only. CSRF still applies (guard).
  app.post(
    '/api/pipelines/validate',
    { preHandler: guard('pipeline:validate') },
    async (request) => {
      const input = parse(validatePipelineSchema, request.body);
      const preview = previewPlan(input.yaml, { ...input.context, runNumber: 0 });
      return ok(preview);
    },
  );
}
