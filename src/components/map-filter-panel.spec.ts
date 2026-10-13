import { expect, fixture, html } from '@open-wc/testing';
import { render as renderTemplate } from 'lit';
import { spy, type SinonSpy } from 'sinon';

import MapFilterPanel from './map-filter-panel.js';
import { buildConnections } from '../foundation/connections.js';
import {
  emptyFilter,
  filterOptions,
  type ConnectionFilter,
} from '../foundation/filter.js';
import { generateScd } from '../testing/generate-scd.js';
import { parseXml } from '../testing/scl.js';

customElements.define('map-filter-panel', MapFilterPanel);

const doc = parseXml(generateScd({ bays: 2 }));
const connections = buildConnections(doc);
const options = filterOptions(connections);

describe('map-filter-panel', () => {
  let panel: MapFilterPanel;
  let filterChange: SinonSpy;
  let viewChange: SinonSpy;
  let connectionSelect: SinonSpy;

  async function render(filter: Partial<ConnectionFilter> = {}) {
    filterChange = spy();
    viewChange = spy();
    connectionSelect = spy();
    panel = await fixture(
      html`<map-filter-panel
        .filter=${{ ...emptyFilter(), ...filter }}
        .options=${options}
        .connections=${connections.slice(0, 3)}
        .drawn=${new Set([connections[0].id])}
        .selectedConnection=${connections[1].id}
        @map-filter-change=${filterChange}
        @map-view-change=${viewChange}
        @map-connection-select=${connectionSelect}
      ></map-filter-panel>`,
    );
  }

  const query = <T extends Element = HTMLElement>(selector: string) =>
    panel.shadowRoot!.querySelector(selector) as T;
  const details = () => filterChange.args.map(([event]) => event.detail);

  function type(selector: string, value: string) {
    const field = query<HTMLInputElement>(selector);
    field.value = value;
    field.dispatchEvent(new Event('input'));
  }

  it('changes text criteria as the user types', async () => {
    await render();
    type('.sourceIed', 'P1');
    type('.targetIed', 'C');
    type('.controlBlock', 'Trip');
    expect(details()).to.deep.equal([
      { sourceIed: 'P1' },
      { targetIed: 'C' },
      { controlBlock: 'Trip' },
    ]);
  });

  it('parses typed VLANs and priorities against the available values', async () => {
    await render();
    type('.vlan-text', '0x101, 999, 512');
    type('.priority-text', '6, 7');
    expect(details()).to.deep.equal([
      { vlans: [257, 512] },
      { priorities: [6] },
    ]);
  });

  it('keeps typed text that matches the selection', async () => {
    await render();
    type('.vlan-text', '0x101');
    panel.filter = { ...panel.filter, vlans: [257] };
    await panel.updateComplete;
    expect(query<HTMLInputElement>('.vlan-text').value).to.equal('0x101');

    panel.filter = { ...panel.filter, vlans: [257, 512] };
    panel.filter = { ...panel.filter, priorities: [4] };
    await panel.updateComplete;
    expect(query<HTMLInputElement>('.vlan-text').value).to.equal('257, 512');
    expect(query<HTMLInputElement>('.priority-text').value).to.equal('4');
  });

  it('toggles VLANs in a filterable list with counts, and priority chips', async () => {
    await render({ vlans: [257] });
    const list = query<HTMLElement & {
      items: { headline: string; supportingText?: string; selected: boolean }[];
      filterable: boolean;
    }>('oscd-selection-list.vlan-options');
    expect(list.filterable).to.equal(true);
    expect(list.items.map(item => item.headline)).to.deep.equal([
      '0x101 (257)',
      '0x102 (258)',
      '0x200 (512)',
      '0x201 (513)',
    ]);
    expect(list.items.map(item => item.selected)).to.deep.equal([
      true,
      false,
      false,
      false,
    ]);
    expect(list.items.every(item => /connection/.test(item.supportingText!))).to.equal(
      true,
    );
    // The list flips an item's selection, then reports the change.
    list.items[2].selected = true;
    list.dispatchEvent(new Event('selection-list-change'));

    query('[data-priority="5"]').click();
    query('.vlans-all').click();
    await panel.updateComplete;
    query('.vlans-none').click();
    expect(details()).to.deep.equal([
      { vlans: [257, 512] },
      { priorities: [5] },
      { vlans: options.vlans },
      { vlans: [] },
    ]);
    expect(query('.vlans .badge').textContent).to.equal('1 of 4');
  });

  it('selects types in a manufacturer tree', async () => {
    await render({ types: ['ProtCo|PR-500'] });
    type Node = { id: string; label: string; detail: string; children?: Node[] };
    const tree = query<HTMLElement & {
      data: Node[];
      selectedIds: string[];
      expandedIds: string[];
      isSelectable: (node: Node) => boolean;
    }>('oscd-tree.types');
    expect(tree.data.map(node => [node.label, node.detail])).to.deep.equal([
      ['GateCorp', '1 type'],
      ['ProtCo', '1 of 3 selected'],
      ['SampleWorks', '1 type'],
    ]);
    const protCo = tree.data[1];
    expect(protCo.children!.map(node => node.id)).to.include('ProtCo|PR-500');
    expect(tree.isSelectable(protCo)).to.equal(false);
    expect(tree.isSelectable(protCo.children![0])).to.equal(true);
    expect(tree.selectedIds).to.deep.equal(['ProtCo|PR-500']);
    // Manufacturers with selected types are expanded.
    expect(tree.expandedIds).to.deep.equal(['manufacturer:ProtCo']);

    tree.dispatchEvent(
      new CustomEvent('selected-ids-changed', {
        detail: { selectedIds: ['ProtCo|PR-500', 'GateCorp|GW-1'] },
      }),
    );
    tree.dispatchEvent(
      new CustomEvent('expanded-ids-changed', {
        detail: { expandedIds: ['manufacturer:GateCorp'] },
      }),
    );
    await panel.updateComplete;
    expect(details()).to.deep.equal([
      { types: ['ProtCo|PR-500', 'GateCorp|GW-1'] },
    ]);
    expect(tree.expandedIds).to.have.members([
      'manufacturer:GateCorp',
      'manufacturer:ProtCo',
    ]);
    // Rows show the name and a count.
    const row = document.createElement('div');
    renderTemplate(
      (tree as unknown as { renderItem: (c: { node: Node }) => unknown }).renderItem({
        node: protCo,
      }),
      row,
    );
    expect(
      Array.from(row.querySelectorAll('span > span'), span =>
        span.textContent?.trim(),
      ),
    ).to.deep.equal(['ProtCo', '1 of 3 selected']);
  });

  it('collapses sections and shows the selected IED scope', async () => {
    await render({ ied: 'P1', sourceIed: 'P' });
    expect(query('.scope').textContent).to.contain('IED P1');
    expect(query('.names .badge').textContent).to.equal('1');
    const section = query<HTMLDetailsElement>('details.vlans');
    section.open = false;
    section.dispatchEvent(new Event('toggle'));
    await panel.updateComplete;
    expect(query<HTMLDetailsElement>('details.vlans').open).to.equal(false);
    section.dispatchEvent(new Event('toggle'));
    section.open = true;
    section.dispatchEvent(new Event('toggle'));
    await panel.updateComplete;
    expect(query<HTMLDetailsElement>('details.vlans').open).to.equal(true);

    await render();
    expect(query('.scope') === null).to.equal(true);
  });

  it('resets criteria and closes', async () => {
    await render({ sourceIed: 'x', ied: 'P1' });
    query('.reset').click();
    query('.close').click();
    expect(details()[0]).to.include({ sourceIed: '', ied: 'P1' });
    expect(viewChange.firstCall.args[0].detail).to.deep.equal({
      filterOpen: false,
    });
  });

  it('lists connections, flagging those not on the diagram', async () => {
    await render();
    const items = Array.from(
      panel.shadowRoot!.querySelectorAll('oscd-list-item'),
    );
    expect(query('details.connections .title').textContent).to.equal(
      '3 connections',
    );
    const open = ['names', 'vlans', 'priorities', 'manufacturers', 'connections'].map(
      section => query<HTMLDetailsElement>(`details.${section}`).open,
    );
    expect(open).to.deep.equal([true, false, false, false, false]);
    expect(items.map(item => item.textContent?.includes('not on the diagram')))
      .to.deep.equal([false, true, true]);
    expect(items[1].classList.contains('selected')).to.equal(true);

    (items[2] as HTMLElement).click();
    expect(connectionSelect.firstCall.args[0].detail).to.deep.equal({
      id: connections[2].id,
    });
  });

  it('hides VLAN and priority criteria without values', async () => {
    await render();
    panel.options = {
      ...options,
      vlans: [],
      priorities: [],
      manufacturers: new Map(),
    };
    panel.connections = connections.slice(0, 1);
    await panel.updateComplete;
    expect(query('.vlans') === null).to.equal(true);
    expect(query('.priorities') === null).to.equal(true);
    expect(query('.manufacturers') === null).to.equal(true);
    expect(query('details.connections .title').textContent).to.equal(
      '1 connection',
    );
  });
});
