import { loadConfig } from '../config/env.js';
import { createLogger } from '../lib/logger.js';
import { migrate, resetSchema } from './migrate.js';
import { createPool } from './pool.js';
import { seed } from './seed.js';

async function main(): Promise<void> {
  const command = process.argv[2];
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL, 'railyard-db');
  const pool = createPool(config.DATABASE_URL, 2);
  try {
    if (command === 'migrate') {
      const applied = await migrate(pool, logger);
      logger.info({ count: applied.length }, 'migrations complete');
    } else if (command === 'seed') {
      await seed(pool, logger);
    } else if (command === 'reset') {
      await resetSchema(pool, config.NODE_ENV);
      await migrate(pool, logger);
      await seed(pool, logger);
    } else {
      throw new Error(`usage: cli.ts <migrate|seed|reset> (got '${command ?? ''}')`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
