import { expect, fixture, html } from '@open-wc/testing';
import { spy } from 'sinon';

import MapConnectionDialog, {
  detailsStorageKey,
  isQualityInput,
  qualityStorageKey,
} from './map-connection-dialog.js';
import { buildConnections } from '../foundation/connections.js';
import type { Connection } from '../foundation/types.js';
import { generateScd } from '../testing/generate-scd.js';
import { parseXml, scl } from '../testing/scl.js';

customElements.define('map-connection-dialog', MapConnectionDialog);

const doc = parseXml(generateScd({ bays: 1 }));
const connections = buildConnections(doc);
const find = (service: string, target: string) =>
  connections.find(c => c.service === service && c.target.name === target)!;

describe('map-connection-dialog', () => {
  let dialog: MapConnectionDialog;

  async function render(connection?: Connection) {
    dialog = await fixture(
      html`<map-connection-dialog .connection=${connection}></map-connection-dialog>`,
    );
  }

  const query = (selector: string) =>
    dialog.shadowRoot!.querySelector(selector) as HTMLElement | null;
  const texts = (selector: string) =>
    Array.from(dialog.shadowRoot!.querySelectorAll(selector)).map(e =>
      e.textContent?.replace(/\s+/g, ' ').trim(),
    );

  it('is closed without a connection', async () => {
    await render();
    expect((query('oscd-dialog') as HTMLElement & { open: boolean }).open).to.equal(
      false,
    );
  });

  it('shows the communication details of a GOOSE connection', async () => {
    await render(find('GOOSE', 'C1'));
    expect(query('.headline')?.textContent).to.contain('P1:Trip ⮕ C1');
    expect(texts('.details tr')).to.deep.equal([
      'Data set dsTrip',
      'Configuration revision 1',
      'GOOSE ID P1Trip',
      'VLAN ID 0x101 (257)',
      'VLAN priority 5',
      'Application ID 1001',
      'MAC address 01-0C-CD-01-00-01',
      'Minimum time 4',
      'Maximum time 1000',
    ]);
    expect(query('.supervision')?.textContent).to.contain(
      'Supervision: LD0/LGOS1 (Supervision of P1)',
    );
  });

  it('omits supervision when there is none', async () => {
    await render(find('Report', 'GW'));
    expect(query('.supervision') === null).to.equal(true);
    expect(texts('.details tr')).to.deep.equal([
      'Data set dsMeas',
      'Configuration revision 1',
      'Report ID C1Meas',
    ]);
  });

  it('lists inputs and hides quality inputs on request', async () => {
    localStorage.removeItem(qualityStorageKey);
    await render(find('SV', 'P1'));
    // Quality inputs are hidden by default.
    expect(texts('.inputs tbody tr')).to.have.length(2);
    expect(texts('.inputs tbody tr')[0]).to.contain('LD0/TCTR1.AmpSv.instMag.i');

    const toggle = query('oscd-switch') as HTMLElement & { selected: boolean };
    toggle.selected = true;
    toggle.dispatchEvent(new Event('change'));
    await dialog.updateComplete;
    expect(texts('.inputs tbody tr')).to.have.length(4);
    expect(localStorage.getItem(qualityStorageKey)).to.equal('on');

    // Remembered for the next connection opened.
    await render(find('SV', 'P1'));
    expect(texts('.inputs tbody tr')).to.have.length(4);
    localStorage.removeItem(qualityStorageKey);
  });

  it('requests removal of one or all inputs', async () => {
    const connection = find('SV', 'P1');
    await render(connection);
    const handler = spy();
    dialog.addEventListener('map-remove-inputs', handler);
    query('.remove-input')!.click();
    query('.remove-all')!.click();
    expect(handler.firstCall.args[0].detail.inputs).to.deep.equal([
      connection.inputs[0],
    ]);
    expect(handler.secondCall.args[0].detail.inputs).to.equal(connection.inputs);
  });

  it('reports when it was closed', async () => {
    await render(find('GOOSE', 'C1'));
    const handler = spy();
    dialog.addEventListener('map-connection-close', handler);
    query('oscd-dialog')!.dispatchEvent(new Event('closed'));
    expect(handler.callCount).to.equal(1);
  });

  it('recognises quality inputs', () => {
    const [q, nested, value] = Array.from(
      scl(
        '<ExtRef daName="q"/><ExtRef daName="phsA.q"/><ExtRef daName="stVal"/>',
      ).querySelectorAll('ExtRef'),
    );
    expect([q, nested, value].map(isQualityInput)).to.deep.equal([
      true,
      true,
      false,
    ]);
  });

  it('remembers whether message information is shown', async () => {
    localStorage.removeItem(detailsStorageKey);
    await render(find('GOOSE', 'C1'));
    const details = () => query('details') as HTMLDetailsElement;
    // Folded by default, previewing key values.
    expect(details().open).to.equal(false);
    expect(query('.preview')?.textContent).to.match(/^VLAN 0x.* · APPID /);

    details().open = true;
    details().dispatchEvent(new Event('toggle'));
    details().dispatchEvent(new Event('toggle'));
    expect(localStorage.getItem(detailsStorageKey)).to.equal('on');
    await dialog.updateComplete;
    expect(query('.preview') === null).to.equal(true);

    await render(find('GOOSE', 'C1'));
    expect(details().open).to.equal(true);
    details().open = false;
    details().dispatchEvent(new Event('toggle'));
    expect(localStorage.getItem(detailsStorageKey)).to.equal('off');
    localStorage.removeItem(detailsStorageKey);
  });
});
