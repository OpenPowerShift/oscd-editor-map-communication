# Theming

The plugin follows the OpenSCD theming model described in
[`@openscd/oscd-api` docs/theming.md](https://github.com/openscd/oscd-api/blob/main/docs/theming.md).
All declarations live in [`src/theme.ts`](src/theme.ts).

## How it works

1. **Distro palette.** The root component initialises internal `--oscd-*`
   tokens from the distro's `--oscd-theme-*` variables, falling back to the
   Solarized defaults. Sub-components only use the internal tokens. The plugin
   never sets `--oscd-theme-*` itself.
2. **Material components.** `oscd-ui`'s `oscdMd3Mappings` maps the same palette
   to the `--md-sys-color-*` roles used by buttons, chips, fields and dialogs.
   The shape scale (`--md-sys-shape-corner-*`) is derived from
   `--oscd-theme-shape`.
3. **Single line diagram.** The embedded `sld-substation-viewer` reads the same
   `--oscd-theme-*` palette; see the
   [oscd-editor-sld theming guide](https://github.com/OMICRONEnergyOSS/oscd-editor-sld/blob/main/THEMING.md)
   for its `--oscd-editor-sld-*` hooks, which can be set on this plugin's
   element as well.

## Palette variables read

| Variable | Used for |
| --- | --- |
| `--oscd-theme-primary` | Keyboard focus ring of IEDs, selected list entries, active filter button |
| `--oscd-theme-secondary` | Default highlight colour (selected IED, hovered or selected connection, linked equipment) |
| `--oscd-theme-error` | "Remove all" action |
| `--oscd-theme-base00`, `base01`, `base1` | Text, secondary text, borders |
| `--oscd-theme-base2`, `base3` | Panel and table backgrounds |
| `--oscd-theme-shape` | Corner radii |
| `--oscd-theme-text-font`, `text-font-mono`, `icon-font` | Fonts |

## Plugin hooks

| Hook | Default | Affects |
| --- | --- | --- |
| `--oscd-editor-map-communication-goose-color` | `#268bd2` | GOOSE connections and service chip icon |
| `--oscd-editor-map-communication-sv-color` | `#cb4b16` | Sampled Value connections and service chip icon |
| `--oscd-editor-map-communication-report-color` | `#859900` | Report connections and service chip icon |
| `--oscd-editor-map-communication-highlight-color` | `--oscd-theme-secondary` | Selected IED, hovered/selected connection, linked equipment |
| `--oscd-editor-map-communication-diagram-opacity` | `0.7` | Opacity of the single line diagram's equipment, wiring, bays and their labels (IEDs and highlighted equipment stay at full strength) |

Set any of them on the plugin element, a host shell or `:root`:

```css
oscd-editor-map-communication {
  --oscd-editor-map-communication-goose-color: #0077cc;
}
```

`demo/index-themed.html` shows the plugin with a dark palette and custom
service colours.
