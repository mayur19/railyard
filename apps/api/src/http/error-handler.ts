import type { FastifyError, FastifyInstance } from 'fastify';
import { AppError } from './errors.js';
import { fail } from './envelope.js';

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      if (error.statusCode === 429) {
        const retry = (error.details as { retryAfterSeconds?: number } | undefined)
          ?.retryAfterSeconds;
        if (retry) void reply.header('retry-after', String(retry));
      }
      const body = {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      };
      return reply.status(error.statusCode).send(fail(body));
    }
    const status =
      typeof error.statusCode === 'number' && error.statusCode >= 400 ? error.statusCode : 500;
    if (status < 500) {
      const code =
        error.code === 'FST_ERR_CTP_BODY_TOO_LARGE' ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST';
      return reply.status(status).send(fail({ code, message: error.message }));
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send(fail({ code: 'INTERNAL', message: 'Internal server error' }));
  });

  app.setNotFoundHandler((request, reply) =>
    reply
      .status(404)
      .send(
        fail({ code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found` }),
      ),
  );
}
