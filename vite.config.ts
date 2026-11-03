/// <reference types="vitest/config" />
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
    // Both ports are origins the backend allows for CORS; strictPort so a busy port fails instead of moving.
    server: { port: Number(env.PORT || 3001), strictPort: true },
    preview: { port: Number(env.PREVIEW_PORT || 3002), strictPort: true },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['src/test-setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      env: { VITE_TIME_ZONE: 'Africa/Nairobi', VITE_IDLE_LOCK_MINUTES: '5', VITE_API_BASE_URL: 'http://api.test/api', VITE_APP_ENV: 'local' }
    }
  };
});
