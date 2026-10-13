import { expect } from '@open-wc/testing';

import { buildConnections, iedReferenceMap } from './connections.js';
import { generateScd } from '../testing/generate-scd.js';
import { iedXml, parseXml, placedSubstation, scl } from '../testing/scl.js';

const gse = '<GSEControl name="gse1" datSet="ds"/>';
const smv = '<SampledValueControl name="smv1" datSet="ds"/>';

function extRef(attributes: string): string {
  return `<ExtRef ${attributes}/>`;
}

function inputs(...extRefs: string[]): string {
  return `<Inputs>${extRefs.join('')}</Inputs>`;
}

function summary(doc: XMLDocument): string[] {
  return buildConnections(doc).map(
    c => `${c.service} ${c.source.name}>${c.target.name} ${c.inputs.length}`,
  );
}

describe('buildConnections', () => {
  it('matches GOOSE subscriptions by srcLDInst, srcLNClass and srcCBName', () => {
    const doc = scl(
      iedXml('Pub', gse) +
        iedXml(
          'Sub',
          inputs(
            extRef(
              'iedName="Pub" ldInst="LD0" lnClass="PTRC" lnInst="1" doName="Tr" srcLDInst="LD0" srcLNClass="LLN0" srcCBName="gse1"',
            ),
            extRef(
              'iedName="Pub" ldInst="LD0" lnClass="PTRC" lnInst="1" doName="Op" srcLDInst="LD0" srcLNClass="LLN0" srcCBName="gse1"',
            ),
          ),
        ),
    );
    expect(summary(doc)).to.deep.equal(['GOOSE Pub>Sub 2']);
  });

  it('falls back to ldInst and LLN0 when src attributes are missing', () => {
    const doc = scl(
      iedXml('Pub', smv) +
        iedXml('Sub', inputs(extRef('iedName="Pub" ldInst="LD0" srcCBName="smv1"'))),
    );
    expect(summary(doc)).to.deep.equal(['SV Pub>Sub 1']);
  });

  it('ignores ExtRefs with a different logical device, prefix or instance', () => {
    const doc = scl(
      iedXml('Pub', gse) +
        iedXml(
          'Sub',
          inputs(
            extRef('iedName="Pub" srcLDInst="LD1" srcCBName="gse1"'),
            extRef('iedName="Pub" srcLDInst="LD0" srcPrefix="X" srcCBName="gse1"'),
            extRef('iedName="Pub" srcLDInst="LD0" srcLNInst="1" srcCBName="gse1"'),
            extRef('iedName="Pub" srcLDInst="LD0" srcLNClass="LPHD" srcCBName="gse1"'),
            extRef('iedName="Other" srcLDInst="LD0" srcCBName="gse1"'),
            extRef('iedName="Pub" srcCBName="gse1"'),
          ),
        ),
    );
    expect(summary(doc)).to.deep.equal([]);
  });

  it('ignores ExtRefs whose serviceType does not fit the control block', () => {
    const doc = scl(
      iedXml('Pub', gse + smv.replace('smv1', 'gse1')) +
        iedXml(
          'Sub',
          inputs(
            extRef('iedName="Pub" ldInst="LD0" serviceType="GOOSE" srcCBName="gse1"'),
          ),
        ),
    );
    expect(summary(doc)).to.deep.equal(['GOOSE Pub>Sub 1']);
  });

  it('groups inputs per subscribing IED', () => {
    const ref = extRef('iedName="Pub" ldInst="LD0" srcCBName="gse1"');
    const doc = scl(
      iedXml('Pub', gse) +
        iedXml('A', inputs(ref, ref), `<LN lnClass="GGIO" inst="1">${inputs(ref)}</LN>`) +
        iedXml('B', inputs(ref)),
    );
    expect(summary(doc)).to.deep.equal(['GOOSE Pub>A 3', 'GOOSE Pub>B 1']);
  });

  it('creates report connections from ClientLN elements', () => {
    const report = `<ReportControl name="rp1"><RptEnabled><ClientLN iedName="Client" ldInst="LD0" lnClass="ITCI" lnInst="1"/><ClientLN iedName="Client" ldInst="LD0" lnClass="ITCI" lnInst="2"/><ClientLN iedName="Missing" ldInst="LD0" lnClass="ITCI" lnInst="1"/></RptEnabled></ReportControl>`;
    const doc = scl(
      iedXml('Server', '', `<LN lnClass="MMXU" inst="1">${report}</LN>`) +
        iedXml('Client'),
    );
    expect(summary(doc)).to.deep.equal(['Report Server>Client 2']);
  });

  it('ignores control blocks without subscribers', () => {
    const doc = scl(iedXml('Pub', gse + smv));
    expect(buildConnections(doc)).to.have.length(0);
  });

  it('gives connections stable ids and resolves IED references', () => {
    const doc = scl(
      placedSubstation(['Pub']) +
        iedXml('Pub', gse) +
        iedXml('Sub', inputs(extRef('iedName="Pub" ldInst="LD0" srcCBName="gse1"'))),
    );
    const [connection] = buildConnections(doc);
    expect(connection.id).to.equal('Pub>>LD0>gse1→Sub');
    expect(connection.source.reference?.localName).to.equal('Reference');
    expect(connection.target.reference).to.equal(null);
  });

  it('attaches communication parameters of GOOSE and SV control blocks', () => {
    const doc = parseXml(generateScd({ bays: 1 }));
    const goose = buildConnections(doc).find(
      c => c.service === 'GOOSE' && c.target.name === 'C1',
    );
    expect(goose?.comm).to.deep.equal({
      vlanId: '101',
      vlanPriority: '5',
      appId: '1001',
      macAddress: '01-0C-CD-01-00-01',
      minTime: '4',
      maxTime: '1000',
    });
  });

  it('finds every connection of the generated sample', () => {
    const doc = parseXml(generateScd({ bays: 2 }));
    expect(summary(doc)).to.have.members([
      'GOOSE P1>C1 2',
      'GOOSE P1>BBP 2',
      'SV MU1>P1 4',
      'SV MU1>BBP 4',
      'Report C1>GW 1',
      'GOOSE P2>C2 2',
      'GOOSE P2>BBP 2',
      'SV MU2>P2 4',
      'SV MU2>BBP 4',
      'Report C2>GW 1',
    ]);
  });

  it('builds connections of a large document quickly', () => {
    const doc = parseXml(generateScd({ bays: 60 }));
    const start = performance.now();
    const connections = buildConnections(doc);
    const duration = performance.now() - start;
    expect(connections).to.have.length(300);
    expect(duration).to.be.lessThan(1000);
  });
});

describe('iedReferenceMap', () => {
  it('maps IED names to their first diagram reference', () => {
    const doc = scl(placedSubstation(['A', 'B']) + placedSubstation(['A'], 'S2'));
    const map = iedReferenceMap(doc);
    expect(Array.from(map.keys())).to.deep.equal(['A', 'B']);
    expect(map.get('A')?.closest('Substation')?.getAttribute('name')).to.equal(
      'S1',
    );
  });
});
