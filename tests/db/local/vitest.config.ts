import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/db/local/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
