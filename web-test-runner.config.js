import base from '@omicronenergy/oscd-tooling/configs/web-test-runner.config.js';

/**
 * Extends the shared oscd-tooling config:
 * - runs test files in parallel pages to keep the suite fast
 * - enforces coverage thresholds of 90%
 */
export default {
  ...base,
  concurrency: 4,
  coverageConfig: {
    ...base.coverageConfig,
    exclude: [...base.coverageConfig.exclude, 'dist/testing/**'],
    threshold: { statements: 90, branches: 90, functions: 90, lines: 90 },
  },
};
