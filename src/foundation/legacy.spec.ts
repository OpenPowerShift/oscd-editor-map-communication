import { expect } from '@open-wc/testing';

import { hasLegacySldLayout } from './legacy.js';
import { generateScd } from '../testing/generate-scd.js';
import { parseXml } from '../testing/scl.js';

const legacyRoot = (body: string) =>
  parseXml(
    `<SCL xmlns="http://www.iec.ch/61850/2003/SCL" xmlns:esld="https://transpower.co.nz/SCL/SSD/SLD/v0" xmlns:eosld="https://openscd.org/SCL/SSD/SLD/v0">${body}</SCL>`,
  );

describe('hasLegacySldLayout', () => {
  it('detects legacy IEDName elements', () => {
    const doc = legacyRoot(
      '<Substation name="S"><Private type="OpenSCD-Linked-IEDs"><esld:IEDName esld:name="A"/></Private></Substation>',
    );
    expect(hasLegacySldLayout(doc)).to.equal(true);
  });

  it('detects legacy substation attributes', () => {
    const doc = legacyRoot('<Substation name="S" esld:w="10" esld:h="10"/>');
    expect(hasLegacySldLayout(doc)).to.equal(true);
  });

  it('accepts documents already placing IEDs in the new format', () => {
    const doc = legacyRoot(
      '<Substation name="S" esld:w="10"><Private type="OpenSCD-SLD-Layout"><eosld:Reference eosld:type="IED" eosld:id="A"/></Private></Substation>',
    );
    expect(hasLegacySldLayout(doc)).to.equal(false);
  });

  it('accepts documents in the new format', () => {
    expect(hasLegacySldLayout(parseXml(generateScd({ bays: 1 })))).to.equal(
      false,
    );
  });
});
