import { loadConfig } from './config/env.js';
import { migrate } from './db/migrate.js';
import { createPool } from './db/pool.js';
import { buildApp } from './http/app.js';
import { createLogger } from './lib/logger.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL, 'railyard-api');
  const pool = createPool(config.DATABASE_URL, config.DATABASE_POOL_MAX);
  await migrate(pool, logger);
  const app = await buildApp({ config, pool, logger });
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
