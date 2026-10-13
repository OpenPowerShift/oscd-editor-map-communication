import OscdMenuOpen from '@omicronenergy/oscd-menu-open';
import OscdMenuSave from '@omicronenergy/oscd-menu-save';

import OscdEditorMapCommunication from '../dist/oscd-editor-map-communication.js';

const oscdShell = document.querySelector('oscd-shell');
const registry = oscdShell?.registry;
if (!oscdShell) {
  throw new Error('oscd-shell not found');
}
if (!registry) {
  throw new Error('oscd-shell registry not found, cannot register plugins');
}

registry.define('oscd-menu-open', OscdMenuOpen);
registry.define('oscd-menu-save', OscdMenuSave);
registry.define('oscd-editor-map-communication', OscdEditorMapCommunication);

/**
 * Loads the latest build of an OMICRONEnergyOSS editor published on GitHub
 * Pages and registers it as `tagName`. The builds bundle shared components
 * (`oscd-scl-dialogs`, `ace-editor`) that they define globally, so while one
 * loads, definitions of names already defined are skipped. Without a network
 * connection the demo goes without the editor.
 */
async function loadFromPages(repository, tagName) {
  const url = `https://omicronenergyoss.github.io/${repository}/${repository}.js`;
  const define = customElements.define;
  customElements.define = function defineOnce(name, ...rest) {
    if (!customElements.get(name)) {
      define.call(this, name, ...rest);
    }
  };
  try {
    registry.define(tagName, (await import(url)).default);
    return true;
  } catch (error) {
    console.warn(`${repository} not loaded from ${url}`, error);
    return false;
  } finally {
    customElements.define = define;
  }
}

const sld = await loadFromPages('oscd-editor-sld', 'oscd-editor-sld');
const source = await loadFromPages('oscd-editor-source', 'oscd-editor-source');

export const plugins = {
  menu: [
    {
      name: 'Open File',
      translations: { de: 'Datei öffnen' },
      icon: 'folder_open',
      tagName: 'oscd-menu-open',
    },
    {
      name: 'Save File',
      translations: { de: 'Datei speichern' },
      icon: 'save',
      requireDoc: true,
      tagName: 'oscd-menu-save',
    },
  ],
  editor: [
    {
      name: 'Communication Map',
      translations: { de: 'Kommunikationskarte' },
      icon: 'hub',
      requireDoc: true,
      tagName: 'oscd-editor-map-communication',
    },
    ...(sld
      ? [
          {
            name: 'Single Line Diagram',
            translations: { de: 'Einpoliges Schaltbild' },
            icon: 'edit',
            requireDoc: true,
            tagName: 'oscd-editor-sld',
          },
        ]
      : []),
    ...(source
      ? [
          {
            name: 'Source',
            translations: { de: 'Quelltext' },
            icon: 'code',
            requireDoc: true,
            tagName: 'oscd-editor-source',
          },
        ]
      : []),
  ],
};
