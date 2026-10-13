import { expect } from '@open-wc/testing';
import { controlBlockGseOrSmv } from '@openscd/scl-lib';

import {
  commAddressIndex,
  findCommAddress,
  formatVlan,
  parseCsvTokens,
  parsePriority,
  parseVlanRaw,
  parseVlanToken,
  readCommParams,
} from './comm-params.js';
import { generateScd } from '../testing/generate-scd.js';
import { parseXml, scl } from '../testing/scl.js';

describe('comm-params', () => {
  describe('findCommAddress', () => {
    it('agrees with controlBlockGseOrSmv for every control block', () => {
      const doc = parseXml(generateScd({ bays: 3 }));
      const index = commAddressIndex(doc);
      const controlBlocks = Array.from(
        doc.querySelectorAll('GSEControl, SampledValueControl, ReportControl'),
      );
      expect(controlBlocks.length).to.be.greaterThan(0);
      controlBlocks.forEach((cb) => {
        const expected =
          cb.tagName === 'ReportControl' ? null : controlBlockGseOrSmv(cb);
        expect(findCommAddress(cb, index) === expected).to.equal(true);
      });
    });

    it('follows ServerAt access points', () => {
      const doc = scl(
        `<Communication><SubNetwork name="N"><ConnectedAP iedName="I" apName="AP2"><GSE ldInst="LD0" cbName="gse1"/></ConnectedAP></SubNetwork></Communication>
        <IED name="I"><AccessPoint name="AP1"><Server><LDevice inst="LD0"><LN0 lnClass="LLN0" inst=""><GSEControl name="gse1"/></LN0></LDevice></Server></AccessPoint><AccessPoint name="AP2"><ServerAt apName="AP1"/></AccessPoint></IED>`,
      );
      const cb = doc.querySelector('GSEControl')!;
      const address = findCommAddress(cb, commAddressIndex(doc));
      expect(address?.parentElement?.getAttribute('apName')).to.equal('AP2');
    });

    it('returns null for control blocks outside an IED server', () => {
      const doc = scl('<GSEControl name="gse1"/>');
      const cb = doc.querySelector('GSEControl')!;
      expect(findCommAddress(cb, commAddressIndex(doc))).to.equal(null);
    });
  });

  describe('readCommParams', () => {
    it('reads address parameters and times', () => {
      const doc = scl(
        '<GSE><Address><P type="VLAN-ID">00A</P><P type="APPID">0001</P></Address><MaxTime>1000</MaxTime></GSE>',
      );
      expect(readCommParams(doc.querySelector('GSE'))).to.deep.equal({
        vlanId: '00A',
        appId: '0001',
        maxTime: '1000',
      });
    });

    it('returns no parameters without an address', () => {
      expect(readCommParams(null)).to.deep.equal({});
    });
  });

  it('parses comma separated tokens', () => {
    expect(parseCsvTokens(' 1, 0x2 ,,3 ')).to.deep.equal(['1', '0x2', '3']);
  });

  it('parses SCL VLAN identifiers as hexadecimal', () => {
    expect(parseVlanRaw('065')).to.equal(101);
    expect(parseVlanRaw('0x00A')).to.equal(10);
    expect(parseVlanRaw('fff')).to.equal(4095);
    expect(parseVlanRaw('xyz')).to.equal(null);
    expect(parseVlanRaw(undefined)).to.equal(null);
  });

  it('parses user VLAN tokens as decimal unless clearly hexadecimal', () => {
    expect(parseVlanToken('101')).to.equal(101);
    expect(parseVlanToken('0x65')).to.equal(101);
    expect(parseVlanToken('a')).to.equal(10);
    expect(parseVlanToken('1g')).to.equal(null);
    expect(parseVlanToken('')).to.equal(null);
  });

  it('parses VLAN priorities', () => {
    expect(parsePriority('4')).to.equal(4);
    expect(parsePriority('0x6')).to.equal(6);
    expect(parsePriority('high')).to.equal(null);
    expect(parsePriority(null)).to.equal(null);
  });

  it('formats VLAN identifiers in hexadecimal and decimal', () => {
    expect(formatVlan('065')).to.equal('0x065 (101)');
    expect(formatVlan('weird')).to.equal('weird');
  });
});
