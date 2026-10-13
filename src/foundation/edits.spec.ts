import { expect } from '@open-wc/testing';
import type { EditV2 } from '@openscd/oscd-api';
import { isRemove, isSetAttributes } from '@openscd/oscd-api/utils.js';

import { buildConnections } from './connections.js';
import { removeInputsEdits } from './edits.js';
import { generateScd } from '../testing/generate-scd.js';
import { parseXml } from '../testing/scl.js';

/** Applies the edit kinds produced by unsubscribing to the document. */
function apply(edits: EditV2[]): void {
  edits.flat(Infinity as 1).forEach((edit) => {
    if (isRemove(edit)) {
      edit.node.parentNode?.removeChild(edit.node);
    } else if (isSetAttributes(edit)) {
      Object.entries(edit.attributes ?? {}).forEach(([name, value]) => {
        if (value === null) {
          edit.element.removeAttribute(name);
        } else {
          edit.element.setAttribute(name, String(value));
        }
      });
    }
  });
}

describe('removeInputsEdits', () => {
  it('removes ClientLNs of a report connection', () => {
    const doc = parseXml(generateScd({ bays: 1 }));
    const report = buildConnections(doc).find(c => c.service === 'Report')!;
    apply(removeInputsEdits(report.inputs));
    expect(doc.querySelectorAll('ClientLN')).to.have.length(0);
    expect(
      buildConnections(doc).filter(c => c.service === 'Report'),
    ).to.have.length(0);
  });

  it('unsubscribes ExtRefs and their supervision', () => {
    const doc = parseXml(generateScd({ bays: 1 }));
    const goose = buildConnections(doc).find(
      c => c.service === 'GOOSE' && c.target.name === 'C1',
    )!;
    expect(doc.querySelector('IED[name="C1"] LN[lnClass="LGOS"]')).to.exist;

    apply(removeInputsEdits(goose.inputs));

    const remaining = buildConnections(doc).map(
      c => `${c.source.name}>${c.target.name}`,
    );
    expect(remaining).not.to.include('P1>C1');
    expect(remaining).to.include('P1>BBP');
    // ExtRefs with intAddr are kept for later binding but unbound
    const extRefs = Array.from(
      doc.querySelectorAll('IED[name="C1"] ExtRef[intAddr]'),
    );
    expect(extRefs).to.have.length(2);
    expect(extRefs.every(extRef => !extRef.hasAttribute('iedName'))).to.equal(
      true,
    );
  });

  it('returns no edits without inputs', () => {
    expect(removeInputsEdits([])).to.deep.equal([]);
  });
});
