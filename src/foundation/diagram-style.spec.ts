import { expect } from '@open-wc/testing';

import { fadeRules } from './diagram-style.js';

describe('diagram-style', () => {
  it('keeps the labels of IEDs and kept elements at full strength', () => {
    const rules = fadeRules(['P1', 'say "hi"'], ['S1>E1>B1>QA1']);
    expect(rules).to.contain('#sld g[id="label:P1"] *');
    expect(rules).to.contain('#sld g[id="label:say \\"hi\\""] *');
    expect(rules).to.contain('#sld g[id="S1>E1>B1>QA1"] * { opacity: 1; }');
    expect(fadeRules([])).to.not.contain('opacity: 1');
  });

  it('fades shapes, not the groups nesting IEDs', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<svg id="sld">
      <defs><symbol id="sym"><g><path id="in-symbol"/></g></symbol></defs>
      <g class="voltagelevel" id="vl"><rect id="vl-rect"/>
        <g class="bay" id="bay"><path id="wire"/>
          <g class="ied" id="ied"><use id="ied-use"/></g>
          <g class="equipment" id="eq"><use id="eq-use"/></g>
          <g class="equipment" id="other"><use id="other-use"/></g>
        </g>
      </g>
      <g class="label" id="label:P1"><text id="ied-text"/></g>
      <g class="label" id="label:QA1"><text id="eq-text"/></g>
    </svg>`;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(fadeRules(['P1'], ['eq']));
    root.adoptedStyleSheets = [sheet];
    const opacity = (id: string) => {
      let value = 1;
      for (
        let element: Element | null = root.getElementById(id);
        element && element.id !== 'sld';
        element = element.parentElement
      ) {
        value *= Number(getComputedStyle(element).opacity);
      }
      return value;
    };
    expect(
      ['ied-use', 'ied-text', 'eq-use', 'in-symbol'].map(opacity),
    ).to.deep.equal([1, 1, 1, 1]);
    expect(
      ['vl-rect', 'wire', 'other-use', 'eq-text'].map(id =>
        opacity(id).toFixed(2),
      ),
    ).to.deep.equal(['0.70', '0.70', '0.70', '0.70']);
    host.remove();
  });
});
