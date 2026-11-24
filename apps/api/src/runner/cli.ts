import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';
import { createLogger } from '../lib/logger.js';
import { Runner } from './runner.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL, 'railyard-runner');
  const pool = createPool(config.DATABASE_URL, 4);
  const runner = new Runner({
    pool,
    logger,
    config,
    ...(config.RUNNER_NAME ? { name: config.RUNNER_NAME } : {}),
  });
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'runner stopping after current job');
    await runner.stop();
    await pool.end();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  runner.start();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
