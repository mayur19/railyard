import { z } from 'zod';

export type TrustProxySetting = false | number | string[];

const IP_OR_CIDR = /^[0-9A-Fa-f:.]+(\/\d{1,3})?$/;

/** Parses TRUST_PROXY. Returns null when invalid. `true` is rejected on purpose (trusts any client). */
export function parseTrustProxy(raw: string): TrustProxySetting | null {
  if (raw === '' || raw === 'false' || raw === '0') return false;
  if (/^\d{1,2}$/.test(raw)) return Number(raw);
  const list = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length > 0 && list.every((item) => IP_OR_CIDR.test(item)) ? list : null;
}

const boolish = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4105),
  APP_ORIGIN: z.string().url().default('http://localhost:5105'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(168),
  COOKIE_SECURE: boolish.default('false'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** false (default), a hop count such as 1, or a comma-separated list of proxy IPs/CIDRs. */
  TRUST_PROXY: z
    .string()
    .trim()
    .default('false')
    .transform(parseTrustProxy)
    .refine(
      (v) => v !== null,
      'TRUST_PROXY must be false, a hop count, or a comma-separated IP/CIDR list',
    )
    .transform((v) => v as TrustProxySetting),
  LOGIN_IP_RATE_LIMIT: z.coerce.number().int().min(1).default(50),
  LOGIN_RATE_WINDOW_SECONDS: z.coerce.number().int().min(1).default(900),
  LOGIN_EMAIL_FREE_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  LOGIN_BACKOFF_BASE_SECONDS: z.coerce.number().int().min(1).default(30),
  LOGIN_BACKOFF_MAX_SECONDS: z.coerce.number().int().min(1).default(3600),
  LOGIN_MAX_EMAILS_PER_IP: z.coerce.number().int().min(1).default(20),
  RATE_LIMIT_MAX_KEYS: z.coerce.number().int().min(10).default(10000),
  REGISTER_RATE_LIMIT: z.coerce.number().int().min(1).default(5),
  REGISTER_RATE_WINDOW_SECONDS: z.coerce.number().int().min(1).default(3600),
  WORKSPACE_ROOT: z.string().default('.workspaces'),
  RUNNER_NAME: z.string().optional(),
  RUNNER_LEASE_SECONDS: z.coerce.number().int().min(5).max(600).default(30),
  RUNNER_POLL_MS: z.coerce.number().int().min(50).max(60000).default(1000),
  RUNNER_KEEP_WORKSPACES: boolish.default('false'),
});

export type AppConfig = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Validates process.env (or a supplied record). Throws ConfigError listing every problem. */
export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new ConfigError(`Invalid configuration:\n  ${problems.join('\n  ')}`);
  }
  if (result.data.NODE_ENV === 'production' && source.TRUST_PROXY === undefined) {
    throw new ConfigError(
      'Invalid configuration:\n  TRUST_PROXY must be set explicitly in production (false, a hop count, or proxy IPs/CIDRs)',
    );
  }
  if (result.data.NODE_ENV === 'production' && !result.data.COOKIE_SECURE) {
    throw new ConfigError('Invalid configuration:\n  COOKIE_SECURE must be true in production');
  }
  return result.data;
}
