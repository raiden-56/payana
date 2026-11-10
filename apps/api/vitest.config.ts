import { defineConfig } from 'vitest/config';

// Unit tests: pure domain rules and small helpers. No database, no network.
export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json. Requires Vite 8.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/domain/**/*.ts', 'src/common/*.ts'],
      reporter: ['text-summary', 'lcov'],
    },
  },
});
