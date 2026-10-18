import { expect } from '@open-wc/testing';
import { setViewport } from '@web/test-runner-commands';
import { visualDiff } from '@web/test-runner-visual-regression';

import OscdEditorMapCommunication from './oscd-editor-map-communication.js';
import { generateScd } from './testing/generate-scd.js';
import { parseXml } from './testing/scl.js';

/**
 * Screenshot tests for how the plugin looks. What the plugin does is checked by
 * the `*.spec.ts` files, so each screenshot here protects a distinct visual
 * state: the map, the filter panel, a selected IED, the connection details
 * dialog, the IED search, the export menu and the empty states.
 *
 * Baselines are owned by CI and must not be created or updated locally, see
 * `.github/workflows/update-visual-baselines.yml`.
 */

customElements.define(
  'oscd-editor-map-communication',
  OscdEditorMapCommunication,
);

const wide = { width: 1280, height: 800 };
const small = { width: 800, height: 480 };

describe('oscd-editor-map-communication screenshots', () => {
  let plugin: OscdEditorMapCommunication;

  before(async () => {
    await setViewport({ width: 1400, height: 900 });
  });

  afterEach(() => {
    plugin.remove();
    localStorage.clear();
  });

  async function settle(): Promise<void> {
    const viewer = plugin.shadowRoot?.querySelector(
      'sld-substation-viewer',
    ) as (HTMLElement & { updateComplete?: Promise<unknown> }) | null;
    await viewer?.updateComplete;
    await plugin.updateComplete;
    await new Promise(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    // Menus and dialogs open with a short animation; wait for it to settle.
    await new Promise(resolve => setTimeout(resolve, 400));
    await plugin.updateComplete;
  }

  async function mount(
    xml: string | undefined,
    size: { width: number; height: number } = wide,
  ): Promise<void> {
    const element = document.createElement(
      'oscd-editor-map-communication',
    ) as OscdEditorMapCommunication;
    element.style.width = `${size.width}px`;
    element.style.height = `${size.height}px`;
    document.body.append(element);
    plugin = element;
    await plugin.updateComplete;
    if (xml !== undefined) {
      plugin.doc = parseXml(xml);
      plugin.docVersion = 1;
      await plugin.updateComplete;
      await plugin.routingDone;
    }
    await settle();
  }

  const shadow = () => plugin.shadowRoot!;
  const toolbar = () =>
    shadow().querySelector('map-toolbar') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
  const layer = () => shadow().querySelector('map-connection-layer')!;

  function fire(target: Element, type: string, detail: unknown): void {
    target.dispatchEvent(
      new CustomEvent(type, { detail, bubbles: true, composed: true }),
    );
  }

  const shot = (name: string) => visualDiff(plugin, name);

  it('map initially', async () => {
    await mount(generateScd({ bays: 2 }));
    await shot('map initially');
  });

  it('filter panel open', async () => {
    await mount(generateScd({ bays: 2 }));
    plugin.view = { ...plugin.view, filterOpen: true };
    await settle();
    await shot('filter panel open');
  });

  it('an IED is selected', async () => {
    await mount(generateScd({ bays: 2 }));
    fire(layer(), 'map-ied-select', { name: 'C1' });
    await settle();
    await shot('ied selected');
  });

  it('a connection is selected', async () => {
    await mount(generateScd({ bays: 2 }));
    fire(layer(), 'map-connection-select', { id: plugin.connections[0].id });
    await settle();
    await shot('connection details');
  });

  it('the IED search shows matches', async () => {
    await mount(generateScd({ bays: 2 }));
    const search = toolbar()
      .shadowRoot!.querySelector('map-ied-search')!
      .shadowRoot!.querySelector('oscd-outlined-search-field') as HTMLElement & {
        value: string;
      };
    search.value = 'P';
    search.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await settle();
    await shot('ied search');
  });

  it('the export menu is open', async () => {
    await mount(generateScd({ bays: 2 }));
    (
      toolbar().shadowRoot!.querySelector('#export-button') as HTMLElement
    ).click();
    await settle();
    await shot('export menu');
  });

  it('the substation selector is shown', async () => {
    await mount(
      generateScd({ bays: 1 }).replace(
        '</Substation>',
        '</Substation><Substation name="AA2"><Private type="OpenSCD-SLD-Layout"><eosld:SLDAttributes eosld:w="4" eosld:h="3"/></Private></Substation>',
      ),
    );
    await shot('substation selector');
  });

  it('no IEDs are placed', async () => {
    await mount(
      generateScd({ bays: 1 }).replace(
        /<eosld:Reference .*?<\/eosld:Reference>/g,
        '',
      ),
      small,
    );
    await shot('no ieds placed');
  });

  it('there are no connections', async () => {
    await mount(
      generateScd({ bays: 1 }).replace(
        /<Inputs>.*?<\/Inputs>|<RptEnabled.*?<\/RptEnabled>/g,
        '',
      ),
      small,
    );
    await shot('no connections');
  });

  it('the diagram format is outdated', async () => {
    await mount(
      '<SCL xmlns="http://www.iec.ch/61850/2003/SCL" xmlns:esld="https://transpower.co.nz/SCL/SSD/SLD/v0"><Substation name="S" esld:w="5" esld:h="5"/></SCL>',
      small,
    );
    await shot('legacy diagram format');
  });

  it('no document is loaded', async () => {
    await mount(undefined, small);
    expect(shadow().querySelector('.empty')).to.exist;
    await shot('no document');
  });
});
