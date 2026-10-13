import { expect } from '@open-wc/testing';

import { matchRank, searchIeds, type SearchableIed } from './ied-search.js';

const ied = (name: string, substation = 'S1', desc?: string): SearchableIed => ({
  name,
  substation,
  desc,
});

describe('ied-search', () => {
  it('ranks exact, prefix, part, substring and description matches', () => {
    expect(matchRank(ied('P1'), 'p1')).to.equal(0);
    expect(matchRank(ied('BRT_312_P1'), 'brt')).to.equal(1);
    expect(matchRank(ied('BRT_312_P1'), '312')).to.equal(2);
    expect(matchRank(ied('BusBarProt'), 'bar')).to.equal(2);
    expect(matchRank(ied('BRT_312_P1'), '12_p')).to.equal(3);
    expect(matchRank(ied('X1', 'S1', 'Main protection'), 'main')).to.equal(4);
    expect(matchRank(ied('X1'), 'zz')).to.equal(undefined);
    expect(matchRank(ied('X1'), '  ')).to.equal(undefined);
  });

  it('lists the best matches first, preferring the shown substation', () => {
    const ieds = [
      ied('OHG_482_MU2', 'OHG'),
      ied('OHG_482_MU10', 'OHG'),
      ied('PNA_482_MU2', 'PNA'),
      ied('MU482', 'OHG'),
      ied('X', 'OHG', 'merging unit 482'),
    ];
    expect(searchIeds(ieds, '482', 'PNA').map(({ name }) => name)).to.deep.equal([
      'PNA_482_MU2',
      'OHG_482_MU2',
      'OHG_482_MU10',
      'MU482',
      'X',
    ]);
    expect(searchIeds(ieds, '482', 'OHG', 2)).to.have.length(2);
    expect(searchIeds(ieds, '')).to.deep.equal([]);
  });
});
