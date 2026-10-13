import { expect } from '@open-wc/testing';

import {
  existingSupervision,
  fcdaDescriptions,
  inputDestination,
  inputSource,
  isBound,
} from './inputs.js';
import { generateScd } from '../testing/generate-scd.js';
import { iedXml, parseXml, scl } from '../testing/scl.js';

const publisherLns = `<LN prefix="TC" lnClass="TCTR" inst="1" desc="CT"><DOI name="AmpSv" desc="Amps"><SDI name="instMag" desc="Instantaneous"><DAI name="i" desc="Integer"/></SDI></DOI><DOI name="Pos"><DAI name="d"><Val>Position</Val></DAI></DOI></LN>`;

const publisher = `<IED name="Pub"><AccessPoint name="AP1"><Server><LDevice inst="LD0" desc="Logical device"><LN0 lnClass="LLN0" inst=""><DataSet name="ds"><FCDA ldInst="LD0" prefix="TC" lnClass="TCTR" lnInst="1" doName="AmpSv" daName="instMag.i" fc="MX"/><FCDA ldInst="LD0" prefix="TC" lnClass="TCTR" lnInst="1" doName="Pos" fc="ST"/></DataSet><GSEControl name="gse1" datSet="ds"/></LN0>${publisherLns}</LDevice></Server></AccessPoint></IED>`;

describe('inputs', () => {
  const doc = scl(
    publisher +
      iedXml(
        'Sub',
        `<Inputs><ExtRef iedName="Pub" ldInst="LD0" prefix="TC" lnClass="TCTR" lnInst="1" doName="AmpSv" daName="instMag.i" intAddr="in1" desc="Input one" srcCBName="gse1"/><ExtRef iedName="Pub" ldInst="LD0" prefix="TC" lnClass="TCTR" lnInst="1" doName="Pos" srcCBName="gse1"/><ExtRef iedName="Pub" ldInst="LD0" lnClass="XCBR" lnInst="1" doName="Other" srcCBName="gse1"/><ExtRef intAddr="unbound"/></Inputs>`,
        '<LN lnClass="ITCI" inst="1"/>',
      ),
  );
  const cb = doc.querySelector('GSEControl')!;
  const [mapped, valueDesc, unmatched, unbound] = Array.from(
    doc.querySelectorAll('ExtRef'),
  );

  it('recognises bound ExtRefs and ClientLNs', () => {
    expect(isBound(mapped)).to.equal(true);
    expect(isBound(unbound)).to.equal(false);
    expect(isBound(scl('<ClientLN/>').querySelector('ClientLN')!)).to.equal(
      true,
    );
  });

  it('collects descriptions along the FCDA instance path', () => {
    const fcda = doc.querySelector('FCDA')!;
    expect(fcdaDescriptions(fcda)).to.deep.equal({
      LDevice: 'Logical device',
      LN: 'CT',
      DOI: 'Amps',
      SDI: ['Instantaneous'],
      DAI: 'Integer',
    });
  });

  it('uses the d value when a DOI has no description', () => {
    const fcda = doc.querySelectorAll('FCDA')[1];
    expect(fcdaDescriptions(fcda).DOI).to.equal('Position');
  });

  it('returns partial descriptions for unknown data', () => {
    const fcda = scl(
      '<IED name="X"><AccessPoint><Server><LDevice inst="LD0"><LN0 lnClass="LLN0" inst=""><DataSet><FCDA ldInst="LD0" lnClass="LLN0" doName="Missing"/></DataSet></LN0></LDevice></Server></AccessPoint></IED>',
    ).querySelector('FCDA')!;
    expect(fcdaDescriptions(fcda)).to.deep.equal({});
    const orphan = scl('<FCDA ldInst="LD0"/>').querySelector('FCDA')!;
    expect(fcdaDescriptions(orphan)).to.deep.equal({});
  });

  it('describes the source of an ExtRef from its FCDA', () => {
    expect(inputSource(mapped, cb)).to.deep.equal({
      reference: 'LD0/TCTCTR1.AmpSv.instMag.i',
      desc: 'Logical device > CT > Amps > Instantaneous > Integer',
    });
    expect(inputSource(unmatched, cb)).to.deep.equal({
      reference: 'LD0/XCBR1.Other',
    });
  });

  it('describes ClientLN sources by logical node', () => {
    const clientLn = scl(
      '<ClientLN iedName="C" ldInst="LD0" prefix="P" lnClass="ITCI" lnInst="1"/>',
    ).querySelector('ClientLN')!;
    expect(inputSource(clientLn, cb)).to.deep.equal({ reference: 'PITCI1' });
  });

  it('describes the destination by intAddr, description or identity', () => {
    expect(inputDestination(mapped)).to.deep.equal({
      reference: 'in1',
      desc: 'Input one',
    });
    expect(inputDestination(valueDesc).reference).to.contain('Sub');
    const clientLn = scl(
      '<ClientLN desc="Gateway" iedName="C"/>',
    ).querySelector('ClientLN')!;
    expect(inputDestination(clientLn)).to.deep.equal({ reference: 'Gateway' });
  });

  it('finds LGOS and LSVS supervision of a control block', () => {
    const sample = parseXml(generateScd({ bays: 1 }));
    const goose = sample.querySelector('IED[name="P1"] GSEControl')!;
    const sv = sample.querySelector('IED[name="MU1"] SampledValueControl')!;
    const controller = sample.querySelector('IED[name="C1"]')!;
    const protection = sample.querySelector('IED[name="P1"]')!;

    expect(existingSupervision(goose, controller)?.getAttribute('lnClass')).to.equal('LGOS');
    expect(existingSupervision(sv, protection)?.getAttribute('lnClass')).to.equal('LSVS');
    expect(existingSupervision(goose, protection)).to.equal(null);
    const report = sample.querySelector('ReportControl')!;
    expect(existingSupervision(report, controller)).to.equal(null);
  });
});
