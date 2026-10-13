import { expect, fixture, html } from '@open-wc/testing';

import OscdEditorMapCommunication from './oscd-editor-map-communication.js';
import { generateScd } from './testing/generate-scd.js';
import { parseXml } from './testing/scl.js';

customElements.define(
  'oscd-editor-map-communication',
  OscdEditorMapCommunication,
);

type Viewer = HTMLElement & {
  substation: Element;
  gridSize: number;
  showLabels: boolean;
  highlight: { id: string }[];
};

type Layer = HTMLElement & {
  connections: { id: string }[];
  ieds: { name: string }[];
  selectedIed?: string;
  gridSize: number;
  describe: (id: string) => string;
};

describe('oscd-editor-map-communication', () => {
  let plugin: OscdEditorMapCommunication;

  beforeEach(async () => {
    localStorage.removeItem('oscd-editor-map-communication');
    plugin = await fixture(
      html`<oscd-editor-map-communication
        style="width: 800px; height: 600px"
      ></oscd-editor-map-communication>`,
    );
  });

  afterEach(() => {
    plugin.remove();
    localStorage.removeItem('oscd-editor-map-communication');
  });

  const shadow = () => plugin.shadowRoot!;
  const viewer = () => shadow().querySelector('sld-substation-viewer') as Viewer;
  const layer = () => shadow().querySelector('map-connection-layer') as Layer;
  const emptyText = () => shadow().querySelector('.empty')?.textContent;

  async function load(xml = generateScd({ bays: 2 })) {
    plugin.doc = parseXml(xml);
    plugin.docVersion = 1;
    await plugin.updateComplete;
  }

  function fire(target: Element, type: string, detail: unknown) {
    target.dispatchEvent(
      new CustomEvent(type, { detail, bubbles: true, composed: true }),
    );
    return plugin.updateComplete;
  }

  it('shows a message when no document is loaded', () => {
    expect(emptyText()).to.equal('No document loaded');
  });

  it('shows a message when the document has no substation', async () => {
    await load('<SCL xmlns="http://www.iec.ch/61850/2003/SCL"/>');
    expect(emptyText()).to.equal('No substation found in this document');
  });

  it('asks to convert documents using the legacy SLD format', async () => {
    await load(
      '<SCL xmlns="http://www.iec.ch/61850/2003/SCL" xmlns:esld="https://transpower.co.nz/SCL/SSD/SLD/v0"><Substation name="S" esld:w="5" esld:h="5"/></SCL>',
    );
    expect(emptyText()).to.contain('Single Line Diagram editor');
  });

  it('explains when no IEDs are placed or nothing communicates', async () => {
    const notice = () => shadow().querySelector('.notice')?.textContent ?? '';
    await load(
      generateScd({ bays: 1 }).replace(
        /<eosld:Reference .*?<\/eosld:Reference>/g,
        '',
      ),
    );
    expect(notice()).to.contain('No IEDs are placed');

    await load(
      generateScd({ bays: 1 }).replace(
        /<Inputs>.*?<\/Inputs>|<RptEnabled.*?<\/RptEnabled>/g,
        '',
      ),
    );
    expect(notice()).to.contain('No GOOSE, Sampled Value or Report connections');

    await load();
    expect(notice()).to.equal('');
  });

  it('renders each substation with its connections overlaid', async () => {
    await load();
    expect(viewer().substation.getAttribute('name')).to.equal('AA1');
    expect(layer().connections).to.have.length(plugin.connections.length);
    expect(layer().ieds.map(i => i.name)).to.include.members([
      'P1',
      'MU1',
      'C1',
      'BBP',
      'GW',
    ]);
  });

  it('describes connections for tooltips', async () => {
    await load();
    const [first] = plugin.connections;
    expect(layer().describe(first.id)).to.contain(first.source.name);
    expect(layer().describe('unknown')).to.equal('');
  });

  it('selects IEDs, highlighting linked equipment and filtering', async () => {
    await load();
    await fire(layer(), 'map-ied-select', { name: 'C1' });
    expect(layer().selectedIed).to.equal('C1');
    expect(viewer().highlight.map(h => h.id)).to.deep.equal([
      'AA1>E1>B1>QA1',
      'AA1>E1>B1>QB1',
    ]);
    expect(layer().connections).to.have.length(2);

    await fire(layer(), 'map-ied-select', { name: 'C1' });
    expect(layer().selectedIed).to.equal(undefined);
    expect(viewer().highlight).to.deep.equal([]);
  });

  it('clears the IED selection with Escape', async () => {
    await load();
    await fire(layer(), 'map-ied-select', { name: 'C1' });
    shadow()
      .querySelector('main')!
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
      );
    await plugin.updateComplete;
    expect(plugin.filter.ied).to.equal(undefined);
  });

  it('applies toolbar filter and view changes and remembers them', async () => {
    await load();
    const toolbar = shadow().querySelector('map-toolbar')!;
    await fire(toolbar, 'map-filter-change', { services: ['Report'] });
    expect(layer().connections).to.have.length(2);

    await fire(toolbar, 'map-view-change', { gridSize: 40, showLabels: false });
    await plugin.updateComplete;
    expect(viewer().gridSize).to.equal(40);
    expect(layer().gridSize).to.equal(40);
    expect(viewer().showLabels).to.equal(false);

    const stored = JSON.parse(
      localStorage.getItem('oscd-editor-map-communication')!,
    );
    expect(stored).to.deep.equal({
      services: ['Report'],
      showLabels: false,
      filterOpen: false,
      gridSize: 40,
    });
  });

  it('restores remembered settings', async () => {
    localStorage.setItem(
      'oscd-editor-map-communication',
      JSON.stringify({ services: ['SV'], gridSize: 24, showLabels: false }),
    );
    const restored = new OscdEditorMapCommunication();
    expect(restored.filter.services).to.deep.equal(['SV']);
    expect(restored.view).to.deep.equal({
      gridSize: 24,
      showLabels: false,
      filterOpen: false,
    });

    localStorage.setItem('oscd-editor-map-communication', 'not json');
    expect(new OscdEditorMapCommunication().view.gridSize).to.equal(32);
  });

  it('zooms with the mouse wheel around the pointer', async () => {
    await load();
    plugin.view = { ...plugin.view, gridSize: 32 };
    await plugin.updateComplete;
    const main = shadow().querySelector('main')!;
    main.dispatchEvent(
      new WheelEvent('wheel', { deltaY: -100, cancelable: true }),
    );
    await plugin.updateComplete;
    expect(plugin.view.gridSize).to.be.closeTo(32 * Math.exp(0.2), 0.1);

    main.dispatchEvent(new WheelEvent('wheel', { deltaY: 3, deltaMode: 1 }));
    main.dispatchEvent(new WheelEvent('wheel', { deltaX: 5 }));
    await plugin.updateComplete;
    expect(plugin.view.gridSize).to.be.lessThan(32 * Math.exp(0.2) - 0.1);
  });

  it('zooms with the keyboard, ignoring text fields', async () => {
    await load();
    plugin.view = { ...plugin.view, gridSize: 32 };
    await plugin.updateComplete;
    const key = (k: string, init: KeyboardEventInit = {}) => {
      shadow()
        .querySelector('main')!
        .dispatchEvent(
          new KeyboardEvent('keydown', {
            key: k,
            bubbles: true,
            composed: true,
            ...init,
          }),
        );
      return plugin.updateComplete;
    };
    await key('+');
    expect(plugin.view.gridSize).to.equal(40);
    await key('-');
    expect(plugin.view.gridSize).to.equal(32);
    await key('=', { ctrlKey: true });
    expect(plugin.view.gridSize).to.equal(40);
    await key('-', { metaKey: true });
    expect(plugin.view.gridSize).to.equal(32);
    // Alt combinations are left to the browser, single keys to text fields.
    await key('+', { altKey: true });
    expect(plugin.view.gridSize).to.equal(32);
    const search = shadow()
      .querySelector('map-toolbar')!
      .shadowRoot!.querySelector('map-ied-search')!
      .shadowRoot!.querySelector('oscd-outlined-search-field')!
      .shadowRoot!.querySelector('input')!;
    search.dispatchEvent(
      new KeyboardEvent('keydown', { key: '+', bubbles: true, composed: true }),
    );
    await plugin.updateComplete;
    expect(plugin.view.gridSize).to.equal(32);
    await key('0');
    const { width, height } = shadow()
      .querySelector('.canvas')!
      .getBoundingClientRect();
    const main = shadow().querySelector('main')!;
    expect(width <= main.clientWidth && height <= main.clientHeight).to.equal(
      true,
    );
    expect(plugin.view.gridSize).to.not.equal(32);
  });

  it('fits the diagram into view on load and on request', async () => {
    await load();
    // Let the toolbar settle (it may wrap) and the fit follow it.
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    await plugin.updateComplete;
    const main = shadow().querySelector('main')!;
    const canvas = shadow().querySelector('.canvas')!;
    const fits = () =>
      canvas.getBoundingClientRect().width <= main.clientWidth &&
      canvas.getBoundingClientRect().height <= main.clientHeight;
    expect(fits()).to.equal(true);

    plugin.view = { ...plugin.view, gridSize: 120 };
    await plugin.updateComplete;
    expect(fits()).to.equal(false);
    shadow().querySelector('map-toolbar')!.dispatchEvent(
      new CustomEvent('map-zoom-fit', { bubbles: true, composed: true }),
    );
    await plugin.updateComplete;
    expect(fits()).to.equal(true);
  });

  it('pans by dragging and swallows the click ending a pan', async () => {
    await load();
    plugin.view = { ...plugin.view, gridSize: 120 };
    await plugin.updateComplete;
    const main = shadow().querySelector('main')!;
    const pointer = (type: string, x: number, init: PointerEventInit = {}) =>
      main.dispatchEvent(
        new PointerEvent(type, {
          clientX: x,
          clientY: x,
          pointerId: 1,
          bubbles: true,
          ...init,
        }),
      );
    pointer('pointerdown', 200, { button: 2 });
    pointer('pointermove', 100);
    expect(main.scrollLeft).to.equal(0);

    pointer('pointerdown', 200);
    pointer('pointermove', 199);
    expect(main.classList.contains('panning')).to.equal(false);
    pointer('pointermove', 150, { pointerId: 2 });
    pointer('pointermove', 100);
    expect(main.classList.contains('panning')).to.equal(true);
    expect(main.scrollLeft).to.equal(100);
    expect(main.scrollTop).to.equal(100);
    pointer('pointerup', 100);
    expect(main.classList.contains('panning')).to.equal(false);

    let clicked = 0;
    main.addEventListener('click', () => {
      clicked += 1;
    });
    main.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    main.click();
    expect(clicked).to.equal(1);

    pointer('pointerdown', 100, { button: 1 });
    pointer('pointerup', 100, { pointerId: 3 });
    pointer('pointerup', 100);
    main.click();
    expect(clicked).to.equal(2);
  });

  it('shows one substation at a time', async () => {
    await load(
      generateScd({ bays: 1 }).replace(
        '</Substation>',
        '</Substation><Substation name="AA2"><Private type="OpenSCD-SLD-Layout"><eosld:SLDAttributes eosld:w="4" eosld:h="3"/></Private></Substation>',
      ),
    );
    expect(shadow().querySelectorAll('sld-substation-viewer')).to.have.length(1);
    expect(viewer().substation.getAttribute('name')).to.equal('AA1');
    const toolbar = shadow().querySelector('map-toolbar') as HTMLElement & {
      substations: string[];
    };
    expect(toolbar.substations).to.deep.equal(['AA1', 'AA2']);

    await fire(toolbar, 'map-view-change', { substation: 'AA2' });
    expect(viewer().substation.getAttribute('name')).to.equal('AA2');
    expect(layer().connections).to.have.length(0);
    expect(shadow().querySelector('.notice')?.textContent).to.contain(
      'No IEDs are placed',
    );

    await fire(toolbar, 'map-view-change', { substation: 'unknown' });
    expect(viewer().substation.getAttribute('name')).to.equal('AA1');
  });

  it('remembers the selected connection while it exists', async () => {
    await load();
    const [first] = plugin.connections;
    await fire(layer(), 'map-connection-select', { id: first.id });
    expect(plugin.selectedConnection).to.equal(first.id);

    plugin.doc = parseXml(generateScd({ bays: 1 }).replace(/<Inputs>.*?<\/Inputs>/g, ''));
    await plugin.updateComplete;
    expect(plugin.selectedConnection).to.equal(undefined);
  });

  it('opens the filter panel with the shown connections', async () => {
    await load();
    expect(shadow().querySelector('map-filter-panel') === null).to.equal(true);
    await fire(shadow().querySelector('map-toolbar')!, 'map-view-change', {
      filterOpen: true,
    });
    const panel = shadow().querySelector('map-filter-panel') as HTMLElement & {
      connections: unknown[];
      drawn: Set<string>;
    };
    expect(panel.connections).to.have.length(plugin.connections.length);
    expect(panel.drawn.size).to.equal(plugin.connections.length);
  });

  it('shows connection details and dispatches removal edits', async () => {
    await load();
    const report = plugin.connections.find(c => c.service === 'Report')!;
    await fire(layer(), 'map-connection-select', { id: report.id });
    const dialog = shadow().querySelector('map-connection-dialog') as HTMLElement & {
      connection?: { id: string };
    };
    expect(dialog.connection?.id).to.equal(report.id);

    const edits: CustomEvent[] = [];
    plugin.addEventListener('oscd-edit-v2', event =>
      edits.push(event as CustomEvent),
    );
    await fire(dialog, 'map-remove-inputs', { inputs: report.inputs });
    await fire(dialog, 'map-remove-inputs', { inputs: [] });
    expect(edits).to.have.length(1);
    expect(edits[0].detail.title).to.equal(
      'Remove 1 input(s) of C1:brcbMeas ⮕ GW',
    );
    expect(edits[0].detail.edit).to.deep.equal([{ node: report.inputs[0] }]);

    await fire(dialog, 'map-connection-close', undefined);
    expect(plugin.selectedConnection).to.equal(undefined);
    expect(dialog.connection).to.equal(undefined);
  });

  it('aligns the connection layer with the diagram', async () => {
    await load();
    await new Promise(requestAnimationFrame);
    const sld = viewer().shadowRoot!.querySelector('svg#sld')!;
    const overlay = layer().shadowRoot!.querySelector('svg')!;
    const a = sld.getBoundingClientRect();
    const b = overlay.getBoundingClientRect();
    expect([b.left, b.top, b.width, b.height]).to.deep.equal([
      a.left,
      a.top,
      a.width,
      a.height,
    ]);
  });

  it('routes in the background, previewing and caching routes', async () => {
    await load();
    const status = () => shadow().querySelector('.routing') !== null;
    await plugin.updateComplete;
    expect(plugin.routing).to.equal(true);
    expect(status()).to.equal(true);
    expect(layer().connections).to.have.length(plugin.connections.length);
    const preview = layer().connections.map(c => (c as { path?: string }).path);

    await plugin.routingDone;
    await plugin.updateComplete;
    expect(plugin.routing).to.equal(false);
    expect(status()).to.equal(false);
    const routed = layer().connections.map(c => (c as { path?: string }).path);
    expect(routed).to.not.deep.equal(preview);

    const toolbar = shadow().querySelector('map-toolbar')!;
    await fire(toolbar, 'map-filter-change', { services: ['GOOSE'] });
    await plugin.routingDone;
    await plugin.updateComplete;
    expect(layer().connections.length).to.be.lessThan(routed.length);
    await fire(toolbar, 'map-filter-change', {
      services: ['GOOSE', 'SV', 'Report'],
    });
    // Back to a routed set of connections: taken from the cache.
    expect(plugin.routing).to.equal(false);
    expect(layer().connections.map(c => (c as { path?: string }).path)).to.deep.equal(
      routed,
    );
  });

  it('stops background routing when nothing is left to route or removed', async () => {
    await load();
    expect(plugin.routing).to.equal(true);
    const toolbar = shadow().querySelector('map-toolbar')!;
    await fire(toolbar, 'map-filter-change', { services: [] });
    expect(layer().connections).to.have.length(0);
    expect(plugin.routing).to.equal(false);

    await fire(toolbar, 'map-filter-change', {
      services: ['GOOSE', 'SV', 'Report'],
    });
    expect(plugin.routing).to.equal(true);
    const done = plugin.routingDone;
    plugin.remove();
    await done;
    expect(plugin.routing).to.equal(true);
  });

  it('fades the diagram but its IEDs', async () => {
    await load();
    await new Promise(requestAnimationFrame);
    const root = viewer().shadowRoot!;
    /** Opacity as drawn: the element's and its ancestors' combined. */
    const opacity = (selector: string) => {
      let value = 1;
      for (
        let element = root.querySelector(selector);
        element && element.id !== 'sld';
        element = element.parentElement
      ) {
        value *= Number(getComputedStyle(element).opacity);
      }
      return Number(value.toFixed(2));
    };
    expect(opacity('g.ied use')).to.equal(1);
    expect(opacity('g[id="label:P1"] text')).to.equal(1);
    expect(opacity('g[id="label:AA1>E1>B1>QA1"] text')).to.equal(0.7);
    expect(opacity('g[id="AA1>E1>B1>QA1"] > :not(g, title)')).to.equal(0.7);

    // Highlighted equipment of a selected IED stays clear.
    await fire(layer(), 'map-ied-select', { name: 'C1' });
    await new Promise(requestAnimationFrame);
    expect(opacity('g[id="AA1>E1>B1>QA1"] > :not(g, title)')).to.equal(1);
  });

  it('exports the diagram with its connections as SVG and PNG', async () => {
    await load();
    await plugin.routingDone;
    await plugin.updateComplete;
    plugin.docName = 'site.scd';
    const saved: [Blob, string][] = [];
    plugin.saveExport = (blob, name) => saved.push([blob, name]);

    shadow()
      .querySelector('map-toolbar')!
      .dispatchEvent(
        new CustomEvent('map-export', {
          detail: { scope: 'diagram', format: 'svg' },
          bubbles: true,
          composed: true,
        }),
      );
    await new Promise(resolve => setTimeout(resolve, 0));
    await plugin.exportImage('view', 'png');
    await plugin.exportImage('diagram', 'pdf');
    expect(saved.map(([blob, name]) => [blob.type, name])).to.deep.equal([
      ['image/svg+xml', 'site-AA1-communication.svg'],
      ['image/png', 'site-AA1-communication-view.png'],
      ['application/pdf', 'site-AA1-communication.pdf'],
    ]);
    const svg = await saved[0][0].text();
    expect(svg).to.contain('<svg');
    // The diagram's IEDs and the overlay's connection lines are included.
    expect(svg).to.contain('href="#IED"');
    expect((svg.match(/stroke-dasharray/g) ?? []).length).to.be.greaterThan(0);
    expect(svg).to.not.contain('class="hit"');

    plugin.doc = undefined;
    await plugin.updateComplete;
    await plugin.exportImage('diagram', 'svg');
    expect(saved).to.have.length(3);
  });

  it('locates IEDs found with the search, on any substation', async () => {
    await load(
      generateScd({ bays: 1 }).replace(
        '</Substation>',
        '</Substation><Substation name="AA2"><Private type="OpenSCD-SLD-Layout"><eosld:SLDAttributes eosld:w="4" eosld:h="3"/></Private></Substation>',
      ),
    );
    const toolbar = shadow().querySelector('map-toolbar') as HTMLElement & {
      ieds: { name: string; substation: string; desc?: string }[];
    };
    expect(toolbar.ieds.map(i => i.name)).to.include('P1');
    expect(toolbar.ieds.find(i => i.name === 'P1')!.substation).to.equal('AA1');

    await fire(toolbar, 'map-view-change', { substation: 'AA2', gridSize: 8 });
    await plugin.locateIed({ name: 'P1', substation: 'AA1' });
    expect(viewer().substation.getAttribute('name')).to.equal('AA1');
    expect(plugin.view.gridSize).to.equal(32);
    expect(plugin.flashIed).to.equal('P1');
    await (layer() as unknown as { updateComplete: Promise<boolean> })
      .updateComplete;
    expect(
      layer().shadowRoot!.querySelector('rect.ied.flash')!.getAttribute('data-name'),
    ).to.equal('P1');

    // Unknown IEDs are ignored.
    await plugin.locateIed({ name: 'nope', substation: 'AA1' });
    expect(plugin.flashIed).to.equal('P1');

    await fire(toolbar, 'map-ied-locate', { name: 'C1', substation: 'AA1' });
    await new Promise(resolve => setTimeout(resolve, 0));
    await plugin.updateComplete;
    expect(plugin.flashIed).to.equal('C1');
  });

  it('focuses the IED search with the slash key', async () => {
    await load();
    const main = shadow().querySelector('main')!;
    main.focus();
    main.dispatchEvent(
      new KeyboardEvent('keydown', { key: '/', bubbles: true, composed: true }),
    );
    const search = shadow()
      .querySelector('map-toolbar')!
      .shadowRoot!.querySelector('map-ied-search')!;
    await new Promise(requestAnimationFrame);
    expect(search.shadowRoot!.activeElement?.tagName).to.equal(
      'OSCD-OUTLINED-SEARCH-FIELD',
    );
  });

  it('enters and leaves full screen', async () => {
    await load();
    const requested: string[] = [];
    plugin.requestFullscreen = async () => {
      requested.push('enter');
    };
    const exit = document.exitFullscreen;
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => (requested.length % 2 === 1 ? plugin : null),
    });
    document.exitFullscreen = async () => {
      requested.push('exit');
    };
    try {
      await fire(shadow().querySelector('map-toolbar')!, 'map-fullscreen', undefined);
      document.dispatchEvent(new Event('fullscreenchange'));
      await plugin.updateComplete;
      expect(plugin.fullscreen).to.equal(true);
      await plugin.toggleFullscreen();
      document.dispatchEvent(new Event('fullscreenchange'));
      await plugin.updateComplete;
      expect(requested).to.deep.equal(['enter', 'exit']);
      expect(plugin.fullscreen).to.equal(false);

      plugin.requestFullscreen = () => Promise.reject(new Error('refused'));
      await plugin.toggleFullscreen();
      expect(plugin.fullscreen).to.equal(false);
    } finally {
      document.exitFullscreen = exit;
      delete (document as { fullscreenElement?: unknown }).fullscreenElement;
    }
  });

  it('toggles services, the filter panel and substations from the keyboard', async () => {
    await load(
      generateScd({ bays: 1 }).replace(
        '</Substation>',
        '</Substation><Substation name="AA2"><Private type="OpenSCD-SLD-Layout"><eosld:SLDAttributes eosld:w="4" eosld:h="3"/></Private></Substation>',
      ),
    );
    const key = (k: string, init: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent('keydown', {
        key: k,
        bubbles: true,
        composed: true,
        cancelable: true,
        ...init,
      });
      shadow().querySelector('main')!.dispatchEvent(event);
      return plugin.updateComplete.then(() => event.defaultPrevented);
    };
    expect(await key('g', { ctrlKey: true })).to.equal(true);
    await key('r', { ctrlKey: true });
    expect(plugin.filter.services).to.deep.equal(['SV']);
    await key('s', { ctrlKey: true });
    await key('g', { ctrlKey: true });
    expect(plugin.filter.services).to.deep.equal(['GOOSE']);

    await key('l', { ctrlKey: true });
    expect(plugin.view.showLabels).to.equal(false);
    await key('l');
    expect(plugin.view.showLabels).to.equal(true);

    await key('f');
    expect(plugin.view.filterOpen).to.equal(true);
    await key('F');
    expect(plugin.view.filterOpen).to.equal(false);

    await key(']', { ctrlKey: true });
    expect(viewer().substation.getAttribute('name')).to.equal('AA2');
    await key(']', { ctrlKey: true });
    expect(viewer().substation.getAttribute('name')).to.equal('AA1');
    await key('[', { ctrlKey: true });
    expect(viewer().substation.getAttribute('name')).to.equal('AA2');

    // Unmapped keys and the shell's Ctrl+Shift+F are left alone.
    expect(await key('z', { ctrlKey: true })).to.equal(false);
    expect(await key('F', { ctrlKey: true, shiftKey: true })).to.equal(false);
  });

  it('steps through substations only when there are several', async () => {
    await load();
    plugin.runShortcut('next-substation');
    await plugin.updateComplete;
    expect(viewer().substation.getAttribute('name')).to.equal('AA1');
  });

  it('takes its shortcuts when nothing else has focus, not from elsewhere', async () => {
    await load();
    plugin.view = { ...plugin.view, gridSize: 32 };
    await plugin.updateComplete;
    const press = (target: EventTarget, init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', {
        bubbles: true,
        composed: true,
        cancelable: true,
        ...init,
      });
      target.dispatchEvent(event);
      return plugin.updateComplete.then(() => event.defaultPrevented);
    };
    // The page has focus: the map zooms instead of the browser.
    expect(await press(document.body, { key: '=', ctrlKey: true })).to.equal(true);
    expect(plugin.view.gridSize).to.equal(40);

    // Another field on the page has focus: left alone.
    const field = document.createElement('input');
    document.body.append(field);
    expect(await press(field, { key: '-', ctrlKey: true })).to.equal(false);
    expect(plugin.view.gridSize).to.equal(40);
    field.remove();

    // Not shown (e.g. another editor is open): left alone.
    plugin.style.display = 'none';
    expect(await press(document.body, { key: '-', ctrlKey: true })).to.equal(false);
    plugin.style.display = '';
    expect(plugin.view.gridSize).to.equal(40);
  });
});
