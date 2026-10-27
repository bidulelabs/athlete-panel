import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({
  resolve: {
    alias: {
      '@athlete-panel/contracts': resolve('packages/contracts/src/index.ts'),
      '@athlete-panel/plugin-sdk': resolve('packages/plugin-sdk/src/index.ts'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    testTimeout: 20000,
    fileParallelism: false,
  },
});
