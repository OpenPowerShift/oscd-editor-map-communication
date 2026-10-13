import { expect, fixture, html } from '@open-wc/testing';
import { spy, type SinonSpy } from 'sinon';

import MapIedSearch from './map-ied-search.js';
import type { SearchableIed } from '../foundation/ied-search.js';

customElements.define('map-ied-search', MapIedSearch);

const ieds: SearchableIed[] = [
  { name: 'OHG_482_MU2', substation: 'OHG', desc: 'Merging unit' },
  { name: 'OHG_482_P1', substation: 'OHG', desc: 'OHG_482_P1' },
  { name: 'PNA_482_P1', substation: 'PNA' },
];

describe('map-ied-search', () => {
  let search: MapIedSearch;
  let located: SinonSpy;

  beforeEach(async () => {
    located = spy();
    search = await fixture(
      html`<map-ied-search
        .ieds=${ieds}
        substation="OHG"
        @map-ied-locate=${located}
      ></map-ied-search>`,
    );
  });

  const field = () =>
    search.shadowRoot!.querySelector('oscd-outlined-search-field') as HTMLElement & {
      value: string;
    };
  const menu = () =>
    search.shadowRoot!.querySelector('oscd-menu') as HTMLElement & {
      open: boolean;
    };
  const results = () =>
    Array.from(search.shadowRoot!.querySelectorAll<HTMLElement>('.result'));
  const type = async (text: string) => {
    field().value = text;
    field().dispatchEvent(new Event('input'));
    await search.updateComplete;
  };
  const key = async (name: string) => {
    field().dispatchEvent(
      new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
    );
    await search.updateComplete;
  };
  const choose = (item: HTMLElement) =>
    menu().dispatchEvent(
      new CustomEvent('close-menu', { detail: { initiator: item } }),
    );

  it('lists matching IEDs with details while typing', async () => {
    expect(menu().open).to.equal(false);
    await type('482');
    expect(menu().open).to.equal(true);
    expect(results().map(r => r.dataset.name)).to.deep.equal([
      'OHG_482_MU2',
      'OHG_482_P1',
      'PNA_482_P1',
    ]);
    expect(
      results().map(
        r => r.querySelector('[slot="supporting-text"]')?.textContent ?? '',
      ),
    ).to.deep.equal(['Merging unit', '', 'PNA']);

    await type('zzz');
    expect(search.shadowRoot!.querySelector('.none')?.textContent?.trim()).to.equal(
      'No IED found',
    );
    await key('Enter');
    await key('ArrowDown');
    expect(located.callCount).to.equal(0);

    await type('');
    expect(menu().open).to.equal(false);
  });

  it('picks the best match with Enter', async () => {
    await type('p1');
    await key('Enter');
    expect(located.firstCall.args[0].detail.name).to.equal('OHG_482_P1');
    expect(field().value).to.equal('');
    expect(menu().open).to.equal(false);
  });

  it('moves into the menu with the down arrow and picks from it', async () => {
    await type('482');
    await key('ArrowDown');
    await search.updateComplete;
    expect(search.shadowRoot!.activeElement).to.equal(results()[0]);
    choose(results()[2]);
    expect(located.firstCall.args[0].detail.name).to.equal('PNA_482_P1');
    choose(field());
    expect(located.callCount).to.equal(1);
  });

  it('closes, then clears, with Escape', async () => {
    await type('482');
    await key('Escape');
    expect(menu().open).to.equal(false);
    expect(field().value).to.equal('482');
    await key('Escape');
    expect(field().value).to.equal('');
    await key('a');

    await type('482');
    menu().dispatchEvent(new Event('closed'));
    await search.updateComplete;
    expect(menu().open).to.equal(false);
  });

  it('focuses its field', () => {
    search.focus();
    expect(search.shadowRoot!.activeElement).to.equal(field());
  });
});
