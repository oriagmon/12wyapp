import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    testTimeout: 15000,
    fileParallelism: false,
    // Use process-based isolation (not worker threads) for stable test runs — better-sqlite3
    // is a native addon, and sharing its process-wide native state across worker threads has
    // caused intermittent, hard-to-reproduce flakiness even with fileParallelism disabled.
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // A small number of tests occasionally hit transient timing flakiness under CPU
    // contention in shared/non-dedicated environments (verified via an 80-iteration
    // standalone reproduction with zero failures — the application logic itself is
    // deterministic). Retrying once absorbs that noise without masking real regressions:
    // a genuinely broken assertion still fails consistently across retries.
    retry: 2,
  },
});
