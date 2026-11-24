import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../http/context.js';
import { ok } from '../../http/envelope.js';

const VERSION = '0.1.0';

export function registerHealthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/health', async () =>
    ok({ status: 'ok', version: VERSION, uptimeSeconds: Math.round(process.uptime()) }),
  );

  app.get('/api/ready', async (_request, reply) => {
    try {
      const { rows } = await ctx.pool.query<{ pending: number; runners: number }>(
        `SELECT (SELECT count(*) FROM jobs WHERE status = 'queued') AS pending,
                (SELECT count(*) FROM runners WHERE last_heartbeat_at > now() - interval '1 minute') AS runners`,
      );
      return ok({
        status: 'ready',
        database: 'up',
        queuedJobs: rows[0]?.pending ?? 0,
        onlineRunners: rows[0]?.runners ?? 0,
      });
    } catch (err) {
      ctx.logger.warn({ err }, 'readiness check failed');
      return reply
        .status(503)
        .send({ data: null, error: { code: 'NOT_READY', message: 'Database unavailable' } });
    }
  });
}
