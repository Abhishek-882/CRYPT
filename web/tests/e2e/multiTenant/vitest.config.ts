import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    fileParallelism: false,
    include: ['tests/e2e/multiTenant/**/*.test.ts'],
    testTimeout: 30000,
    env: {
      SESSION_SECRET: 'safecoiner_e2e_session_secret_1234567890',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../../../'),
    },
  },
});
