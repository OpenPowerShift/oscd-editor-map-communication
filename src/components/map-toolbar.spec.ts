import { expect, fixture, html } from '@open-wc/testing';
import { spy, type SinonSpy } from 'sinon';

import MapToolbar, {
  maxGridSize,
  minGridSize,
  zoomGridSize,
  type MapView,
} from './map-toolbar.js';
import { emptyFilter, type ConnectionFilter } from '../foundation/filter.js';

customElements.define('map-toolbar', MapToolbar);

const view: MapView = { gridSize: 32, showLabels: true, filterOpen: false };

describe('map-toolbar', () => {
  let toolbar: MapToolbar;
  let filterChange: SinonSpy;
  let viewChange: SinonSpy;

  async function render(
    filter: Partial<ConnectionFilter> = {},
    viewPatch: Partial<MapView> = {},
  ) {
    filterChange = spy();
    viewChange = spy();
    toolbar = await fixture(
      html`<map-toolbar
        .filter=${{ ...emptyFilter(), ...filter }}
        .view=${{ ...view, ...viewPatch }}
        @map-filter-change=${filterChange}
        @map-view-change=${viewChange}
      ></map-toolbar>`,
    );
  }

  const click = (selector: string) =>
    (toolbar.shadowRoot!.querySelector(selector) as HTMLElement).click();

  it('toggles services keeping their order', async () => {
    await render({ services: ['GOOSE', 'Report'] });
    click('.service[data-service="GOOSE"]');
    click('.service[data-service="SV"]');
    expect(filterChange.firstCall.args[0].detail).to.deep.equal({
      services: ['Report'],
    });
    expect(filterChange.secondCall.args[0].detail).to.deep.equal({
      services: ['GOOSE', 'SV', 'Report'],
    });
  });

  it('shows selection controls only with an IED selected', async () => {
    await render();
    expect(toolbar.shadowRoot!.querySelector('.selection') === null).to.equal(true);

    await render({ ied: 'P1', incoming: true, outgoing: false });
    click('.incoming');
    click('.outgoing');
    expect(filterChange.args.map(([e]) => e.detail)).to.deep.equal([
      { incoming: false },
      { outgoing: true },
    ]);
  });

  it('clears the selection when the IED chip is removed', async () => {
    await render({ ied: 'P1' });
    const chip = toolbar.shadowRoot!.querySelector('.selected-ied')!;
    chip.dispatchEvent(new Event('remove', { cancelable: true }));
    expect(filterChange.firstCall.args[0].detail).to.deep.equal({
      ied: undefined,
    });
  });

  it('zooms within limits', async () => {
    await render();
    click('.zoom-in');
    click('.zoom-out');
    expect(viewChange.args.map(([e]) => e.detail)).to.deep.equal([
      { gridSize: 40 },
      { gridSize: 25.6 },
    ]);

    await render({}, { gridSize: maxGridSize });
    click('.zoom-in');
    await render({}, { gridSize: minGridSize + 1 });
    click('.zoom-out');
    expect(viewChange.args.map(([e]) => e.detail)).to.deep.equal([
      { gridSize: minGridSize },
    ]);
  });

  it('keeps zoom within limits', () => {
    expect(zoomGridSize(32, 1.25)).to.equal(40);
    expect(zoomGridSize(maxGridSize, 2)).to.equal(maxGridSize);
    expect(zoomGridSize(minGridSize, 0.5)).to.equal(minGridSize);
  });

  it('asks to fit the diagram into view', async () => {
    await render();
    const fit = spy();
    toolbar.addEventListener('map-zoom-fit', fit);
    click('.zoom-fit');
    expect(fit.callCount).to.equal(1);
  });

  it('offers a substation choice only with several substations', async () => {
    await render();
    expect(toolbar.shadowRoot!.querySelector('.substation') === null).to.equal(
      true,
    );

    toolbar.substations = ['S1', 'S2'];
    toolbar.view = { ...view, substation: 'S2' };
    await toolbar.updateComplete;
    const select = toolbar.shadowRoot!.querySelector('.substation') as HTMLElement & {
      value: string;
    };
    const selected = Array.from(
      select.querySelectorAll('oscd-select-option[selected]'),
      option => option.getAttribute('value'),
    );
    expect(selected).to.deep.equal(['S2']);
    await new Promise(requestAnimationFrame);
    select.value = 'S1';
    select.dispatchEvent(new Event('change'));
    expect(viewChange.lastCall.args[0].detail).to.deep.equal({
      substation: 'S1',
    });
  });

  it('toggles labels and the filter panel', async () => {
    await render();
    click('.labels');
    click('.filter');
    expect(viewChange.args.map(([e]) => e.detail)).to.deep.equal([
      { showLabels: false },
      { filterOpen: true },
    ]);
  });

  it('shows whether the panel is open and how many filters are active', async () => {
    await render();
    const toggle = () => toolbar.shadowRoot!.querySelector('.filter-toggle')!;
    const label = () =>
      toolbar.shadowRoot!.querySelector('.filter')!.getAttribute('aria-label');
    expect(toggle().classList.contains('active')).to.equal(false);
    expect(toolbar.shadowRoot!.querySelector('.badge') === null).to.equal(true);
    expect(label()).to.equal('Filter connections');

    toolbar.filterCount = 2;
    toolbar.view = { ...view, filterOpen: true };
    await toolbar.updateComplete;
    expect(toggle().classList.contains('active')).to.equal(true);
    expect(toggle().classList.contains('open')).to.equal(true);
    expect(toolbar.shadowRoot!.querySelector('.badge')!.textContent).to.equal('2');
    expect(label()).to.equal('Close the filter panel (2 filters active)');

    toolbar.filterCount = 1;
    await toolbar.updateComplete;
    expect(label()).to.equal('Close the filter panel (1 filter active)');
  });

  it('offers exports of the whole diagram or the visible area', async () => {
    await render();
    const exported = spy();
    toolbar.addEventListener('map-export', exported);
    const menu = () =>
      toolbar.shadowRoot!.querySelector('oscd-menu') as HTMLElement & {
        open: boolean;
      };
    click('.export');
    await toolbar.updateComplete;
    expect(menu().open).to.equal(true);

    const items = Array.from(
      toolbar.shadowRoot!.querySelectorAll<HTMLElement>('.export-item'),
    );
    expect(items.map(item => item.dataset.export)).to.deep.equal([
      'diagram-svg',
      'diagram-png',
      'diagram-pdf',
      'view-svg',
      'view-png',
      'view-pdf',
    ]);
    items.forEach(item => item.click());
    expect(exported.args.map(([e]) => e.detail)).to.deep.equal(
      ['diagram', 'view'].flatMap(scope =>
        ['svg', 'png', 'pdf'].map(format => ({ scope, format })),
      ),
    );
    await toolbar.updateComplete;
    expect(menu().open).to.equal(false);

    click('.export');
    await toolbar.updateComplete;
    menu().dispatchEvent(new Event('closed'));
    await toolbar.updateComplete;
    expect(menu().open).to.equal(false);
  });

  it('offers IED search and full screen', async () => {
    await render();
    const fullscreen = spy();
    toolbar.addEventListener('map-fullscreen', fullscreen);
    const button = () => toolbar.shadowRoot!.querySelector('.fullscreen')!;
    expect(button().getAttribute('aria-label')).to.equal('Full screen');
    click('.fullscreen');
    expect(fullscreen.callCount).to.equal(1);
    toolbar.fullscreen = true;
    await toolbar.updateComplete;
    expect(button().getAttribute('aria-label')).to.equal('Exit full screen');

    toolbar.ieds = [{ name: 'P1', substation: 'S1' }];
    toolbar.substations = ['S1'];
    await toolbar.updateComplete;
    const search = toolbar.shadowRoot!.querySelector('map-ied-search') as HTMLElement & {
      ieds: unknown[];
      substation?: string;
    };
    expect(search.ieds).to.have.length(1);
    expect(search.substation).to.equal('S1');
    toolbar.focusSearch();
    expect(search.shadowRoot!.activeElement?.tagName).to.equal(
      'OSCD-OUTLINED-SEARCH-FIELD',
    );
  });

  it('names the shortcuts in the tooltips', async () => {
    await render({}, {});
    toolbar.substations = ['S1', 'S2'];
    await toolbar.updateComplete;
    const title = (selector: string) =>
      toolbar.shadowRoot!.querySelector(selector)!.getAttribute('title');
    expect(title('.zoom-in')).to.match(/Ctrl\+=|\u2318=/);
    expect(title('.zoom-out')).to.contain('or -');
    expect(title('.zoom-fit')).to.contain('or 0');
    expect(title('.filter')).to.contain('(F)');
    expect(title('.substation')).to.contain('next');
    expect(title('.service[data-service="SV"]')).to.match(/S\)$/);
  });
});
