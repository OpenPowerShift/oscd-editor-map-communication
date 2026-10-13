/** Parses an SCL fragment wrapped in an `SCL` root declaring the SLD namespace. */
export function scl(body: string): XMLDocument {
  return new DOMParser().parseFromString(
    `<SCL xmlns="http://www.iec.ch/61850/2003/SCL" xmlns:eosld="https://openscd.org/SCL/SSD/SLD/v0" version="2007" revision="B">${body}</SCL>`,
    'application/xml',
  );
}

/** Parses a complete XML document string. */
export function parseXml(xml: string): XMLDocument {
  return new DOMParser().parseFromString(xml, 'application/xml');
}

/** An IED with one logical device `LD0` holding the given `LN0` content. */
export function iedXml(
  name: string,
  ln0 = '',
  lns = '',
  attributes = '',
): string {
  return `<IED name="${name}" ${attributes}><AccessPoint name="AP1"><Server><LDevice inst="LD0"><LN0 lnClass="LLN0" inst="" lnType="LLN0">${ln0}</LN0>${lns}</LDevice></Server></AccessPoint></IED>`;
}

/** A substation placing the named IEDs on the diagram, one per column. */
export function placedSubstation(iedNames: string[], name = 'S1'): string {
  const references = iedNames
    .map(
      (iedName, i) =>
        `<eosld:Reference eosld:type="IED" eosld:id="${iedName}"><eosld:SLDAttributes eosld:x="${2 + 2 * i}" eosld:y="2" eosld:lx="${2 + 2 * i}" eosld:ly="4"/></eosld:Reference>`,
    )
    .join('');
  return `<Substation name="${name}"><Private type="OpenSCD-SLD-Layout"><eosld:SLDAttributes eosld:w="${4 + 2 * iedNames.length}" eosld:h="6"/>${references}</Private></Substation>`;
}
