import pg from 'pg';

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;
export type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

// Return bigint counts as numbers (we never exceed 2^53 in counts) and keep timestamps as Date.
pg.types.setTypeParser(20, (value: string) => Number(value));

export function createPool(connectionString: string, max = 10): Pool {
  return new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    application_name: 'railyard',
  });
}

/** Runs `fn` inside a transaction, committing on success and rolling back on any error. */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
