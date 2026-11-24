import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import type { Pool } from '../db/pool.js';
import type { LogHub } from '../modules/logs/log-hub.js';
import type { BackoffLimiter, DistinctKeyLimiter, RateLimiter } from './rate-limit.js';

/** Dependencies shared by every route module (constructed once in buildApp). */
export interface AppContext {
  readonly config: AppConfig;
  readonly pool: Pool;
  readonly logger: Logger;
  readonly limiters: {
    /** All login attempts per client IP: catches password spraying across many accounts. */
    readonly loginByIp: RateLimiter;
    /** Failed logins per email with exponential backoff: catches credential stuffing on one account. */
    readonly loginByEmail: BackoffLimiter;
    /** Distinct emails one normalised IP may try per window (protects the per-email store). */
    readonly emailsPerIp: DistinctKeyLimiter;
    readonly registerByIp: RateLimiter;
  };
  readonly logHub: LogHub;
}
