import { defineConfig } from 'vitest/config';

// End-to-end tests: the real application against the real Postgres + PostGIS
// and Redis from docker-compose, in a dedicated `payana_test` database.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: ['./test/setup/global-setup.ts'],
    setupFiles: ['./test/setup/setup-file.ts'],
    // One database is shared by every file, so files run one after another.
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
