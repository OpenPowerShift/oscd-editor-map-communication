[![Test](https://github.com/OpenPowerShift/oscd-editor-map-communication/actions/workflows/test.yml/badge.svg)](https://github.com/OpenPowerShift/oscd-editor-map-communication/actions/workflows/test.yml)

# oscd-editor-map-communication

An [OpenSCD](https://openscd.org) editor plugin that maps IEC 61850
communication — GOOSE, Sampled Values and Reports — onto the single line
diagram (SLD).

The diagram is drawn by the read-only `sld-substation-viewer` from
[`@omicronenergy/oscd-editor-sld`](https://github.com/OMICRONEnergyOSS/oscd-editor-sld).
IEDs appear where they have been placed with the SLD editor, and the plugin
overlays the connections between them, with filtering, IED selection and a
connection details dialog.

This is a re-implementation of
[`scl-communication-editor`](https://github.com/danyill/scl-communication-editor/tree/dev-preview-deploy)
on the current OpenSCD stack (`@openscd/oscd-api` EditV2,
`@openscd/scl-lib`, `@omicronenergy/oscd-ui`, `@omicronenergy/oscd-tooling`).
See [docs/routing.md](docs/routing.md) for how connections are routed.

## Demo

**[Try it on GitHub Pages](https://openpowershift.github.io/oscd-editor-map-communication/)**
(also [with a dark theme](https://openpowershift.github.io/oscd-editor-map-communication/demo/index-themed.html)).
The demo runs OpenSCD with this plugin, the Single Line Diagram editor (to
place IEDs) and the source editor, and opens a generated sample file. Open
your own SCD file from the menu; nothing leaves the browser.

The demo is built and published by the
[Continuous Deployment workflow](.github/workflows/continuous-deployment.yml)
on every push to `main`. It needs GitHub Pages to be enabled for the
repository with *GitHub Actions* as its source (Settings → Pages).

## Features

- GOOSE, Sampled Value and Report connections drawn between the IEDs placed
  on the substation's diagram, colour coded by service with an arrow at the
  receiving IED. Lines are routed orthogonally around IEDs, equipment and
  labels; lines sharing a path are ordered to avoid crossings and spread
  across the free space (see [docs/routing.md](docs/routing.md)). A quick
  preview is shown while the routes are searched in the background.
- One substation at a time, picked in the toolbar when the file has several.
- Zoom with the mouse wheel (around the pointer), the toolbar or the
  keyboard; pan by dragging with the left or middle mouse button. The
  diagram is fitted into view when a file is opened, and stays fitted when
  the view changes size until you zoom or pan.
- Find an IED by typing a few characters of its name or description; the
  map switches substation if needed, zooms in, centres the IED and makes
  it pulse.
- Full screen view of the map, toolbar and filter panel.
- Keyboard shortcuts, active while the map has focus (Command instead of
  Ctrl on macOS), also named in the tooltips:

  | Keys | Action |
  | --- | --- |
  | Ctrl+F or `/` | Find an IED |
  | Ctrl+= / Ctrl+- (or `+` / `-`) | Zoom in / out |
  | Ctrl+0 (or `0`) | Zoom to fit |
  | Ctrl+G / Ctrl+S / Ctrl+R | Show or hide GOOSE / Sampled Values / Reports |
  | Ctrl+[ / Ctrl+] | Previous / next substation |
  | `F` | Open or close the filter panel |
  | Ctrl+L (or `L`) | Show or hide labels |
  | Escape | Clear the IED selection |
- Export the whole diagram or just the visible area as SVG, PNG or PDF, as
  shown on screen (theme colours, connections and filters included). Exports
  work offline: the PDF is written by the plugin itself (one page the size
  of the drawing, holding a lossless image at about 290 dpi).
- The primary diagram is drawn slightly faded so IEDs and connections stand
  out (see `--oscd-editor-map-communication-diagram-opacity` in
  [THEMING.md](THEMING.md)).
- Pointing at a line draws it thicker in the highlight colour; clicking where
  several lines run close together lists them to pick one.
- Service toggles, and IED selection (click or keyboard) showing only that
  IED's connections, with receive/send toggles and its allocated primary
  equipment highlighted. Escape clears the selection.
- Filter panel in collapsible sections: source IED, target IED and control
  block names; VLAN IDs (typed as decimal or hex, or ticked in a list with
  connection counts) and priorities; manufacturers and IED types. With an
  IED selected it offers only what that IED's connections use. It lists all
  shown connections, including those whose IEDs are not placed on the
  diagram.
- Connection details: communication parameters (VLAN, priority, APPID, MAC,
  times), data set, subscription supervision and the source/destination of
  each input, optionally hiding quality attributes.
- Remove single inputs or all inputs of a connection. Edits are dispatched as
  undoable `oscd-edit-v2` events (ExtRefs are unsubscribed with
  `@openscd/scl-lib`, ClientLNs removed).
- Label toggle; service, zoom, label and panel settings are remembered per
  browser.
- Themable through the OpenSCD palette, see [THEMING.md](THEMING.md).

## Requirements on the SCL file

The plugin reads the SLD layout format used by `oscd-editor-sld`
(`https://openscd.org/SCL/SSD/SLD/v0`, `Reference` elements with
`type="IED"`). Files using the older layout format are converted by opening
them in the SLD editor plugin.

## Using this package

```bash
npm install @openpowershift/oscd-editor-map-communication
```

Register the plugin with your OpenSCD distribution, for example:

```js
import OscdEditorMapCommunication from '@openpowershift/oscd-editor-map-communication';

registry.define('oscd-editor-map-communication', OscdEditorMapCommunication);
```

## Development

```bash
npm install     # also installs the git hooks
npm run start   # demo at demo/index.html with oscd-shell, the SLD and source editors
npm run lint    # npm run format to fix
npm run test    # unit tests with coverage (Chromium)
npm run build   # TypeScript build into dist/
npm run bundle  # Rollup bundle of the plugin and the demo
npm run sample  # regenerate demo/sample.scd from src/testing/generate-scd.ts
```

All tooling comes from
[`@omicronenergy/oscd-tooling`](https://www.npmjs.com/package/@omicronenergy/oscd-tooling)
through the `oscd` CLI. Commit messages follow
[Conventional Commits](https://www.conventionalcommits.org/) (checked by a
git hook); releases are created by release-please.

## Continuous integration

Self-contained GitHub Actions workflows, doing what the OMICRONEnergyOSS
plugins' shared workflows do:

- `test.yml`: on every push and pull request, build, lint, unit tests with
  coverage and bundle.
- `release-please.yml`: release pull requests from Conventional Commits;
  when a release is made, publishing to npm (trusted publishing, or the
  `NPM_TOKEN` secret for the first release) and attaching the bundled plugin
  and demo to the GitHub release.
- `continuous-deployment.yml`: on every push to `main`, publishes the bundled
  demo to GitHub Pages (enable Pages with *GitHub Actions* as the source).

## Roadmap

- Move IEDs on the map (embedding the SLD editor).
- Routing improvements: trunks for IEDs receiving very many connections,
  attachment anywhere along an IED face (see
  [docs/routing.md](docs/routing.md#limits-and-ideas)).
- Edition 1 ExtRefs without `srcCBName`, resolved through their data.
- Connections between IEDs placed on different substations.

## License

Copyright 2026 OpenPowerShift.

Licensed under the [Apache License, Version 2.0](LICENSE).
