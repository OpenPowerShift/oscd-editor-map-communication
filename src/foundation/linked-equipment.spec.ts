import { expect } from '@open-wc/testing';

import { linkedEquipment } from './linked-equipment.js';
import { generateScd } from '../testing/generate-scd.js';
import { parseXml, scl } from '../testing/scl.js';

describe('linked-equipment', () => {
  const doc = parseXml(generateScd({ bays: 2 }));
  const substation = doc.querySelector('Substation')!;

  it('finds the equipment allocated to an IED', () => {
    const names = linkedEquipment(substation, 'C1').map(
      e => `${e.closest('Bay')?.getAttribute('name')}/${e.getAttribute('name')}`,
    );
    expect(names).to.deep.equal(['B1/QA1', 'B1/QB1']);
  });

  it('counts equipment once even with several allocated LNodes', () => {
    const doc2 = scl(
      '<Substation><PowerTransformer name="T1"><LNode iedName="P"/><TransformerWinding name="W1"><LNode iedName="P"/></TransformerWinding></PowerTransformer></Substation>',
    );
    const equipment = linkedEquipment(doc2.querySelector('Substation')!, 'P');
    expect(equipment.map(e => e.getAttribute('name'))).to.deep.equal(['T1']);
  });

  it('ignores LNodes outside primary equipment', () => {
    const doc2 = scl('<Substation><Bay><LNode iedName="P"/></Bay></Substation>');
    expect(linkedEquipment(doc2.querySelector('Substation')!, 'P')).to.deep.equal([]);
  });
});
