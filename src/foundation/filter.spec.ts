import { expect } from '@open-wc/testing';

import { buildConnections } from './connections.js';
import {
  clearCriteria,
  emptyFilter,
  filterConnections,
  activeCriteria,
  filterOptions,
  isFilterActive,
  scopeFilter,
  toggleService,
  parsePrioritySelection,
  parseVlanSelection,
  toggleValue,
  type ConnectionFilter,
} from './filter.js';
import { generateScd } from '../testing/generate-scd.js';
import { parseXml } from '../testing/scl.js';

const doc = parseXml(generateScd({ bays: 2 }));
const connections = buildConnections(doc);

function shown(filter: Partial<ConnectionFilter>): string[] {
  return filterConnections(connections, { ...emptyFilter(), ...filter })
    .map(c => `${c.service} ${c.source.name}>${c.target.name}`)
    .sort();
}

describe('filter', () => {
  it('shows everything by default', () => {
    expect(shown({})).to.have.length(connections.length);
    expect(isFilterActive(emptyFilter())).to.equal(false);
  });

  it('toggles services keeping their order', () => {
    expect(toggleService(['GOOSE', 'Report'], 'GOOSE')).to.deep.equal(['Report']);
    expect(toggleService(['Report'], 'SV')).to.deep.equal(['SV', 'Report']);
  });

  it('counts the active criteria', () => {
    expect(activeCriteria(emptyFilter())).to.equal(0);
    expect(
      activeCriteria({
        ...emptyFilter(),
        sourceIed: 'P',
        targetIed: ' ',
        vlans: [1, 2],
        types: ['M|T'],
        ied: 'P1',
      }),
    ).to.equal(3);
  });

  it('filters by service', () => {
    expect(shown({ services: ['Report'] })).to.deep.equal([
      'Report C1>GW',
      'Report C2>GW',
    ]);
  });

  it('shows only the selected IED connections, by direction', () => {
    expect(shown({ ied: 'P1' })).to.deep.equal([
      'GOOSE P1>BBP',
      'GOOSE P1>C1',
      'SV MU1>P1',
    ]);
    expect(shown({ ied: 'P1', outgoing: false })).to.deep.equal(['SV MU1>P1']);
    expect(shown({ ied: 'P1', incoming: false })).to.deep.equal([
      'GOOSE P1>BBP',
      'GOOSE P1>C1',
    ]);
    expect(shown({ ied: 'P1', incoming: false, outgoing: false })).to.deep.equal(
      [],
    );
  });

  it('matches any of several case insensitive name terms', () => {
    expect(shown({ sourceIed: 'mu2  c1' })).to.deep.equal([
      'Report C1>GW',
      'SV MU2>BBP',
      'SV MU2>P2',
    ]);
    expect(shown({ targetIed: 'gw' })).to.have.length(2);
    expect(shown({ controlBlock: 'trip' })).to.have.length(4);
  });

  it('filters GOOSE and SV by VLAN and priority, keeping reports', () => {
    // P1 GOOSE VLAN 0x101 (257) priority 5; P2 GOOSE VLAN 0x102 priority 4
    expect(shown({ vlans: [257] })).to.deep.equal([
      'GOOSE P1>BBP',
      'GOOSE P1>C1',
      'Report C1>GW',
      'Report C2>GW',
    ]);
    expect(shown({ priorities: [6], services: ['GOOSE', 'SV'] })).to.deep.equal([
      'SV MU1>BBP',
      'SV MU1>P1',
      'SV MU2>BBP',
      'SV MU2>P2',
    ]);
    expect(isFilterActive({ ...emptyFilter(), vlans: [1] })).to.equal(true);
  });

  it('filters by manufacturer and type of either end', () => {
    expect(shown({ types: ['GateCorp|GW-1'] })).to.deep.equal([
      'Report C1>GW',
      'Report C2>GW',
    ]);
  });

  it('clears the panel criteria but keeps services and selection', () => {
    const filter = {
      ...emptyFilter(),
      services: ['SV' as const],
      ied: 'P1',
      sourceIed: 'x',
      vlans: [1],
      types: ['a|b'],
    };
    const cleared = clearCriteria(filter);
    expect(isFilterActive(cleared)).to.equal(false);
    expect(cleared.services).to.deep.equal(['SV']);
    expect(cleared.ied).to.equal('P1');
  });

  it('collects the available filter values', () => {
    const options = filterOptions(connections);
    expect(options.vlans).to.deep.equal([0x101, 0x102, 0x200, 0x201]);
    expect(options.priorities).to.deep.equal([4, 5, 6]);
    expect(Object.fromEntries(options.manufacturers)).to.deep.equal({
      GateCorp: ['GW-1'],
      ProtCo: ['BB-700', 'BC-200', 'PR-500'],
      SampleWorks: ['MU-9'],
    });
    expect(options.counts.types.get('GateCorp|GW-1')).to.equal(2);
    expect(
      Array.from(options.counts.vlans.values()).reduce((a, b) => a + b),
    ).to.equal(connections.filter(c => c.service !== 'Report').length);
  });

  it("offers only the selected IED's values, keeping selected ones", () => {
    const filter = { ...emptyFilter(), ied: 'MU1', vlans: [0x200] };
    const scoped = filterConnections(connections, scopeFilter(filter));
    expect(scoped.every(c => [c.source.name, c.target.name].includes('MU1')))
      .to.equal(true);
    const options = filterOptions(scoped, filter);
    expect(options.vlans).to.include(0x200);
    expect(options.vlans.length).to.be.lessThan(4);
    expect(options.counts.vlans.has(0x200)).to.equal(
      scoped.some(c => c.comm.vlanId === '200'),
    );
    expect(Array.from(options.manufacturers.keys())).to.not.include('GateCorp');

    const typed = filterOptions([], { ...emptyFilter(), types: ['M|T'] });
    expect(Object.fromEntries(typed.manufacturers)).to.deep.equal({ M: ['T'] });
    expect(scopeFilter({ ...filter, sourceIed: 'x' })).to.deep.equal({
      ...emptyFilter(),
      ied: 'MU1',
    });
  });

  it('parses typed selections against the available values', () => {
    expect(parseVlanSelection('257, 0x200, 999, x, 257', [257, 512])).to.deep.equal(
      [257, 512],
    );
    expect(parsePrioritySelection('6,4', [4, 5, 6])).to.deep.equal([4, 6]);
  });

  it('toggles values in a sorted selection', () => {
    expect(toggleValue([1, 5], 3)).to.deep.equal([1, 3, 5]);
    expect(toggleValue([1, 3, 5], 3)).to.deep.equal([1, 5]);
  });

});
