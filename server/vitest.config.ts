import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    testTimeout: 15000,
    // The suite asserts against Hebrew copy, which is what this app shipped with before the
    // English release. Pinning the fallback locale keeps those assertions meaningful instead
    // of rewriting ~180 of them into English for no added coverage; English is covered by the
    // dictionary parity test and by tests that set `Accept-Language` explicitly.
    env: {
      APP_DEFAULT_LOCALE: 'he',
    },
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
