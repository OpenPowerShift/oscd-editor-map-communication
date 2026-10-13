import { expect, fixture, html } from '@open-wc/testing';
import { spy } from 'sinon';

import MapConnectionLayer, {
  type ConnectionShape,
  type PlacedIed,
} from './map-connection-layer.js';

customElements.define('map-connection-layer', MapConnectionLayer);

const connections: ConnectionShape[] = [
  {
    id: 'a',
    service: 'GOOSE',
    path: 'M1,1L3,1',
    arrow: 'M3,1L2.9,1Z',
    points: [
      [1, 1],
      [3, 1],
    ],
  },
  {
    id: 'b',
    service: 'SV',
    path: 'M1,2L3,2',
    arrow: 'M3,2L2.9,2Z',
    points: [
      [1, 2],
      [3, 2],
    ],
  },
  {
    id: 'd',
    service: 'GOOSE',
    path: 'M5,1L5,4',
    arrow: 'M5,4L5,3.9Z',
    points: [
      [5, 1],
      [5, 4],
    ],
  },
  {
    id: 'c',
    service: 'Report',
    path: 'M1,2.2L3,2.2',
    arrow: 'M3,2.2L2.9,2.2Z',
    points: [
      [1, 2.2],
      [3, 2.2],
    ],
  },
];

const ieds: PlacedIed[] = [
  { name: 'P1', position: [1, 1] },
  { name: 'P2', position: [3, 1] },
];

describe('map-connection-layer', () => {
  let layer: MapConnectionLayer;

  beforeEach(async () => {
    layer = await fixture(
      html`<map-connection-layer
        .dimensions=${[10, 5]}
        .gridSize=${20}
        .connections=${connections}
        .ieds=${ieds}
        .selectedIed=${'P2'}
        .selectedConnection=${'b'}
        .describe=${(id: string) => `about ${id}`}
      ></map-connection-layer>`,
    );
  });

  const query = (selector: string) =>
    layer.shadowRoot!.querySelector(selector);
  const queryAll = (selector: string) =>
    Array.from(layer.shadowRoot!.querySelectorAll(selector));

  it('sizes the svg like the diagram', () => {
    const svg = query('svg')!;
    expect(svg.getAttribute('viewBox')).to.equal('0 0 10 5');
    expect(svg.getAttribute('width')).to.equal('200');
    expect(svg.getAttribute('height')).to.equal('100');
  });

  it('draws one group per connection, classed by service', () => {
    const groups = queryAll('g.connection');
    expect(groups.map(g => g.getAttribute('class')?.trim())).to.deep.equal([
      'connection goose',
      'connection sv selected',
      'connection goose',
      'connection report',
    ]);
    expect(query('g[data-id="a"] .line')?.getAttribute('d')).to.equal(
      'M1,1L3,1',
    );
    expect(queryAll('g[data-id="d"] .line')).to.have.length(1);
  });

  it('marks the selected IED', () => {
    const targets = queryAll('rect.ied');
    // 2.5 px of room on each side at a grid size of 20 px.
    expect(targets[0].getAttribute('x')).to.equal('0.875');
    expect(targets[0].getAttribute('width')).to.equal('1.25');
    expect(targets.map(t => t.getAttribute('aria-pressed'))).to.deep.equal([
      'false',
      'true',
    ]);
  });

  /** Dispatches a pointer event at grid position `[x, y]`. */
  function pointer(type: string, [x, y]: [number, number], selector = 'g[data-id="a"] .hit') {
    const bounds = query('svg')!.getBoundingClientRect();
    query(selector)!.dispatchEvent(
      new PointerEvent(type, {
        clientX: bounds.left + x * 20,
        clientY: bounds.top + y * 20,
        bubbles: true,
        composed: true,
      }),
    );
    return layer.updateComplete;
  }

  it('highlights the line nearest the pointer, with its tooltip', async () => {
    expect(queryAll('title')).to.have.length(0);
    await pointer('pointermove', [2, 1.05]);
    expect(queryAll('g.hovered').map(g => g.getAttribute('data-id'))).to.deep.equal(
      ['a'],
    );
    expect(queryAll('title').map(t => t.textContent)).to.deep.equal([
      'about a',
    ]);
    await pointer('pointermove', [2, 2.15], 'g[data-id="c"] .hit');
    expect(queryAll('g.hovered').map(g => g.getAttribute('data-id'))).to.deep.equal(
      ['c'],
    );
    // Beyond the pick tolerance but on the line's hit area: that line.
    await pointer('pointermove', [2, 1.28]);
    expect(queryAll('g.hovered').map(g => g.getAttribute('data-id'))).to.deep.equal(
      ['a'],
    );

    // Off the lines the highlight lingers, then goes.
    layer.hoverDelay = 20;
    await pointer('pointermove', [8, 4], 'svg');
    expect(queryAll('g.hovered')).to.have.length(1);
    await pointer('pointermove', [2, 2.15], 'g[data-id="c"] .hit');
    expect(queryAll('g.hovered').map(g => g.getAttribute('data-id'))).to.deep.equal(
      ['c'],
    );
    query('svg')!.dispatchEvent(new PointerEvent('pointerleave'));
    await new Promise(resolve => setTimeout(resolve, 40));
    await layer.updateComplete;
    expect(queryAll('g.hovered')).to.have.length(0);
    expect(queryAll('title')).to.have.length(0);

    layer.hoverDelay = 0;
    await pointer('pointermove', [2, 1]);
    await pointer('pointermove', [8, 4], 'svg');
    expect(queryAll('g.hovered')).to.have.length(0);
    query('svg')!.dispatchEvent(new PointerEvent('pointerleave'));
    layer.remove();
  });

  it('selects a single line on click', async () => {
    const handler = spy();
    layer.addEventListener('map-connection-select', handler);
    await pointer('click', [2, 1]);
    await pointer('click', [8, 4], 'svg');
    // Clicked on the hit area beyond the tolerance: falls back to its line.
    await pointer('click', [2, 0.6]);
    expect(handler.args.map(([e]) => e.detail)).to.deep.equal([
      { id: 'a' },
      { id: 'a' },
    ]);
  });

  const menu = () =>
    query('oscd-menu.chooser') as (HTMLElement & { open: boolean }) | null;
  const choose = (item: Element) =>
    menu()!.dispatchEvent(
      new CustomEvent('close-menu', { detail: { initiator: item } }),
    );

  it('offers a choice when lines are close together', async () => {
    const handler = spy();
    layer.addEventListener('map-connection-select', handler);
    await pointer('click', [2, 2.1], 'g[data-id="b"] .hit');
    const choices = () => queryAll('.choice').map(c => c.getAttribute('data-id'));
    expect(choices()).to.have.members(['b', 'c']);
    expect(menu()!.open).to.equal(true);
    expect(query('.chooser-title')?.textContent).to.contain('2 connections');
    expect(queryAll('.choice').map(c => c.textContent?.trim())).to.have.members([
      'b',
      'c',
    ]);

    const second = query('.choice[data-id="c"]') as HTMLElement;
    second.dispatchEvent(new PointerEvent('pointerenter'));
    await layer.updateComplete;
    expect(queryAll('g.previewed').map(g => g.getAttribute('data-id'))).to.deep.equal(
      ['c'],
    );
    query('.choice[data-id="b"]')!.dispatchEvent(new FocusEvent('focusin'));
    await layer.updateComplete;
    expect(queryAll('g.previewed').map(g => g.getAttribute('data-id'))).to.deep.equal(
      ['b'],
    );
    // No line is hovered while choosing.
    expect(queryAll('g.hovered')).to.have.length(0);

    choose(second);
    await layer.updateComplete;
    expect(handler.firstCall.args[0].detail).to.deep.equal({ id: 'c' });
    expect(queryAll('.choice')).to.have.length(0);
  });

  it('closes the chooser without a choice', async () => {
    layer.label = id => `label ${id}`;
    await pointer('click', [2, 2.1], 'g[data-id="b"] .hit');
    expect(queryAll('.choice').map(c => c.textContent?.trim())).to.have.members([
      'label b',
      'label c',
    ]);
    // Closed without a choice, e.g. Escape or a click elsewhere.
    choose(document.createElement('div'));
    menu()!.dispatchEvent(new Event('closed'));
    await layer.updateComplete;
    expect(queryAll('.choice')).to.have.length(0);

    await pointer('click', [2, 2.1], 'g[data-id="b"] .hit');
    const escape = () =>
      query('svg')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    escape();
    await layer.updateComplete;
    escape();
    expect(queryAll('.choice')).to.have.length(0);
  });

  it('requests IED selection by click and keyboard', () => {
    const handler = spy();
    layer.addEventListener('map-ied-select', handler);
    const target = query('rect.ied[data-name="P1"]')!;
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    target.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(handler.callCount).to.equal(3);
    expect(handler.firstCall.args[0].detail).to.deep.equal({ name: 'P1' });
  });
});
