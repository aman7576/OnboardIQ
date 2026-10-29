import { defineConfig } from 'vitest/config';

// Unit tests need no environment. Import tests use a separate "<db>_test" PostgreSQL database
// (created by test/global-setup.ts) and are skipped, with a warning, if PostgreSQL is not running.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['test/support/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
  },
});
