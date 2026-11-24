import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../../', '');
  const apiTarget = `http://${env.API_HOST ?? '127.0.0.1'}:${env.API_PORT ?? '4105'}`;
  return {
    plugins: [react()],
    server: {
      host: 'localhost',
      port: Number(env.WEB_PORT ?? 5105),
      strictPort: true,
      proxy: { '/api': { target: apiTarget, changeOrigin: false } },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./test/setup.ts'],
      include: ['test/**/*.test.{ts,tsx}'],
      coverage: {
        provider: 'v8',
        include: ['src/graph/**', 'src/components/**', 'src/pages/LoginPage.tsx'],
        thresholds: { lines: 70 },
      },
    },
  };
});
