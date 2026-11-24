import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', 'db/cli': 'src/db/cli.ts', 'runner/cli': 'src/runner/cli.ts' },
  format: ['esm'],
  target: 'node22',
  clean: true,
  sourcemap: true,
  // The shared package ships TypeScript sources; bundle it into the API output.
  noExternal: ['@railyard/shared'],
  external: ['yaml', 'zod', 'pg', 'pino', 'fastify', '@fastify/cookie'],
});
