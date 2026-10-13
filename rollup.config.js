/*
 * Bundles the plugin and the demo pages for GitHub Pages and release
 * archives. Extends the shared @omicronenergy/oscd-tooling config, which
 * only bundles demo/index.html, so the themed demo works when deployed too.
 */
import nodeResolve from '@rollup/plugin-node-resolve';
import { rollupPluginHTML as html } from '@web/rollup-plugin-html';
import { importMetaAssets } from '@web/rollup-plugin-import-meta-assets';
import copy from 'rollup-plugin-copy';

import shared from '@omicronenergy/oscd-tooling/configs/rollup.config.js';

const [plugin, demo] = shared;

export default [
  plugin,
  {
    ...demo,
    input: undefined,
    plugins: [
      html({
        input: ['demo/index.html', 'demo/index-themed.html'],
        minify: true,
      }),
      nodeResolve(),
      importMetaAssets(),
      copy({
        targets: [
          {
            src: [
              'demo/*',
              '!demo/*.html',
              '!demo/plugins.js',
              '!demo/local',
            ],
            dest: 'dist/demo',
          },
        ],
        verbose: true,
        flatten: false,
      }),
    ],
  },
];
