import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: ['**/node_modules/**', '**/dist/**', '**/.worktrees/**'],
    setupFiles: ['./src/test-setup.ts'],
    // Explicitly list faked APIs to exclude setImmediate — Fastify's light-my-request
    // (used by app.inject()) relies on real setImmediate for request processing.
    fakeTimers: {
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    },
  },
});
