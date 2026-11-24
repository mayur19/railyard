import cookie from '@fastify/cookie';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { AppConfig, TrustProxySetting } from '../config/env.js';
import type { Pool } from '../db/pool.js';
import { AuthService } from '../modules/auth/auth.service.js';
import { registerAuthRoutes } from '../modules/auth/auth.routes.js';
import { registerHealthRoutes } from '../modules/health/health.routes.js';
import { createLogHub, type LogHub } from '../modules/logs/log-hub.js';
import { registerLogRoutes } from '../modules/logs/logs.routes.js';
import { registerPendingRoutes } from '../modules/pending/pending.routes.js';
import { registerPipelineRoutes } from '../modules/pipelines/pipelines.routes.js';
import { registerProjectRoutes } from '../modules/projects/projects.routes.js';
import { registerRunRoutes } from '../modules/runs/runs.routes.js';
import { registerSessionLoader } from './auth-hooks.js';
import type { AppContext } from './context.js';
import { registerErrorHandling } from './error-handler.js';
import {
  createBackoffLimiter,
  createDistinctKeyLimiter,
  createRateLimiter,
  type EvictionListener,
} from './rate-limit.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;
const BODY_LIMIT_BYTES = 512 * 1024;

/** Hop counts become a function (hop < n); lists of proxy addresses pass through. Never `true`. */
export function toFastifyTrustProxy(
  setting: TrustProxySetting,
): false | string[] | ((address: string, hop: number) => boolean) {
  if (setting === false) return false;
  if (typeof setting === 'number') return (_address: string, hop: number) => hop < setting;
  return setting;
}

function createLimiters(config: AppConfig, logger: Logger): AppContext['limiters'] {
  const onEvict: EvictionListener = (info) =>
    logger.warn(
      { store: info.store, remainingMs: info.remainingMs },
      'rate-limit store full; evicted active entry',
    );
  const maxKeys = config.RATE_LIMIT_MAX_KEYS;
  return {
    loginByIp: createRateLimiter(config.LOGIN_IP_RATE_LIMIT, config.LOGIN_RATE_WINDOW_SECONDS, {
      maxKeys,
      onEvict,
      name: 'login-ip',
    }),
    loginByEmail: createBackoffLimiter({
      freeAttempts: config.LOGIN_EMAIL_FREE_ATTEMPTS,
      baseSeconds: config.LOGIN_BACKOFF_BASE_SECONDS,
      maxSeconds: config.LOGIN_BACKOFF_MAX_SECONDS,
      maxKeys,
      onEvict,
    }),
    emailsPerIp: createDistinctKeyLimiter(
      config.LOGIN_MAX_EMAILS_PER_IP,
      config.LOGIN_RATE_WINDOW_SECONDS,
      { maxKeys, onEvict },
    ),
    registerByIp: createRateLimiter(
      config.REGISTER_RATE_LIMIT,
      config.REGISTER_RATE_WINDOW_SECONDS,
      { maxKeys, onEvict, name: 'register-ip' },
    ),
  };
}

export interface BuildAppOptions {
  readonly config: AppConfig;
  readonly pool: Pool;
  readonly logger: Logger;
  readonly logHub?: LogHub;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config, pool, logger } = options;
  const app = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    bodyLimit: BODY_LIMIT_BYTES,
    trustProxy: toFastifyTrustProxy(config.TRUST_PROXY),
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)
        ? incoming
        : randomUUID();
    },
  });
  const ctx: AppContext = {
    config,
    pool,
    logger,
    limiters: createLimiters(config, logger),
    logHub: options.logHub ?? createLogHub(config.DATABASE_URL, logger),
  };

  await app.register(cookie);
  app.addHook('onRequest', async (request, reply) => {
    void reply.header('x-request-id', request.id);
    void reply.header('x-content-type-options', 'nosniff');
    void reply.header('x-frame-options', 'DENY');
    void reply.header('referrer-policy', 'no-referrer');
    void reply.header('cache-control', 'no-store');
  });
  app.addHook('onClose', async () => ctx.logHub.close());
  registerErrorHandling(app);

  const auth = new AuthService(pool, config);
  registerSessionLoader(app, auth);
  registerHealthRoutes(app, ctx);
  registerAuthRoutes(app, ctx, auth);
  registerProjectRoutes(app, ctx);
  registerPipelineRoutes(app, ctx);
  registerRunRoutes(app, ctx);
  registerLogRoutes(app, ctx);
  registerPendingRoutes(app);
  return app;
}
