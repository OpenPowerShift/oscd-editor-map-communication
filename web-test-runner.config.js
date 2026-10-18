/* eslint-disable no-undef */
import os from 'os';
import path from 'path';
import { playwrightLauncher } from '@web/test-runner-playwright';
import { visualRegressionPlugin } from '@web/test-runner-visual-regression/plugin';
import oscdConfig from '@omicronenergy/oscd-tooling/configs/web-test-runner.config.js';

/**
 * Extends the shared oscd-tooling config:
 * - `unit` group: `dist/**\/*.spec.js`, the default `npm test`. Only this group
 *   counts towards coverage, which is enforced by the thresholds below.
 * - `visual` group: screenshot tests, `npm run test:visual`. Baselines are
 *   owned by CI (see `.github/workflows/update-visual-baselines.yml`) and are
 *   not updated locally.
 */

// `oscd test --visual` and `--update` also collect coverage, but screenshot
// tests are not meant to cover the code, so only unit runs are held to the
// thresholds.
const groupIndex = process.argv.indexOf('--group');
const isVisualRun =
  process.argv.includes('--update-visual-baseline') ||
  (groupIndex !== -1 && process.argv[groupIndex + 1] === 'visual');

const coverageThreshold = {
  statements: 90,
  branches: 90,
  functions: 90,
  lines: 90,
};

// Chromium flags which reduce differences in text rendering.
const visualBrowsers = [
  playwrightLauncher({
    product: 'chromium',
    launchOptions: {
      args: [
        '--font-render-hinting=none',
        '--disable-skia-runtime-opts',
        '--disable-font-subpixel-positioning',
        '--disable-lcd-text',
        '--disable-gpu',
      ],
    },
  }),
];

const visualRegression = visualRegressionPlugin({
  update: process.argv.includes('--update-visual-baseline'),
  baseDir: 'test/screenshots',
  diffOptions: { includeAA: true },
  getBaselineName: ({ browser, name }) =>
    path.join('baseline', `${name}-${browser}`),
  getDiffName: ({ browser, name }) =>
    path.join('failed', `${name}-${browser}-diff`),
  getFailedName: ({ browser, name }) =>
    path.join('failed', `${name}-${browser}`),
});

export default /** @type {import("@web/test-runner").TestRunnerConfig} */ ({
  ...oscdConfig,

  coverageConfig: {
    ...oscdConfig.coverageConfig,
    exclude: [
      ...oscdConfig.coverageConfig.exclude,
      '**/*.spec.js',
      '**/*.test.js',
      'dist/testing/**',
    ],
    threshold: isVisualRun ? undefined : coverageThreshold,
  },

  plugins: [
    ...oscdConfig.plugins.filter(plugin => plugin.name !== 'visual-regression'),
    visualRegression,
  ],

  groups: oscdConfig.groups.map(group =>
    group.name === 'visual' ? { ...group, browsers: visualBrowsers } : group,
  ),

  // Test files run in parallel pages.
  concurrency: Math.min(4, Math.max(1, os.cpus().length - 1)),
});
