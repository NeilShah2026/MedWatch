import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/core/tests/**/*.test.ts',
      'tests/**/*.test.ts',
      'supabase/**/*.test.ts',
      'apps/web/src/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', 'tests/db/local/**'],
    environment: 'node',
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**/*.ts'],
      exclude: ['packages/core/src/index.ts', 'packages/core/src/types.ts'],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 85 },
      reporter: ['text-summary', 'text'],
    },
  },
});
