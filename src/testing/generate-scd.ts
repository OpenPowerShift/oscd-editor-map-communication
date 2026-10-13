/**
 * Deterministic generator for SCL documents in the new SLD layout format
 * (`https://openscd.org/SCL/SSD/SLD/v0`) containing GOOSE, SV and Report
 * traffic between IEDs placed on the diagram.
 *
 * Pure string building (no DOM) so it can run both in the browser (tests) and
 * in Node (to produce `demo/sample.scd`).
 *
 * Per bay `n` it creates:
 * - `P{n}` protection relay: publishes GOOSE `Trip`, subscribes to `MU{n}` SV
 * - `MU{n}` merging unit: publishes SV `MSVCB01`
 * - `C{n}` bay controller: subscribes to `P{n}` GOOSE, reports to `GW`
 * Station level: `GW` gateway (report client) and `BBP` busbar protection,
 * which subscribes to every `MU` and every `P`.
 */

export interface GenerateScdOptions {
  /** Number of bays (default 4). */
  bays?: number;
  /** Bays per row on the diagram (default 4). */
  baysPerRow?: number;
}

const bayWidth = 9;
const bayHeight = 9;

const manufacturers = {
  P: { manufacturer: 'ProtCo', type: 'PR-500' },
  MU: { manufacturer: 'SampleWorks', type: 'MU-9' },
  C: { manufacturer: 'ProtCo', type: 'BC-200' },
  GW: { manufacturer: 'GateCorp', type: 'GW-1' },
  BBP: { manufacturer: 'ProtCo', type: 'BB-700' },
} as const;

function hex(value: number, width: number): string {
  return value.toString(16).toUpperCase().padStart(width, '0');
}

function mac(prefix: string, index: number): string {
  return `${prefix}-${hex((index >> 8) & 0xff, 2)}-${hex(index & 0xff, 2)}`;
}

function sldAttributes(attrs: Record<string, number>): string {
  const serialised = Object.entries(attrs)
    .map(([key, value]) => `eosld:${key}="${value}"`)
    .join(' ');
  return `<Private type="OpenSCD-SLD-Layout"><eosld:SLDAttributes ${serialised}/></Private>`;
}

function iedReference(name: string, x: number, y: number): string {
  return `<eosld:Reference eosld:type="IED" eosld:id="${name}"><eosld:SLDAttributes eosld:x="${x}" eosld:y="${y}" eosld:lx="${x}" eosld:ly="${y + 2}"/></eosld:Reference>`;
}

function bay(index: number, x: number, y: number): string {
  const n = index + 1;
  const references = [
    iedReference(`P${n}`, x + 4, y + 2),
    iedReference(`MU${n}`, x + 4, y + 5),
    iedReference(`C${n}`, x + 7, y + 2),
  ].join('');

  return `<Bay name="B${n}">
      <Private type="OpenSCD-SLD-Layout"><eosld:SLDAttributes eosld:x="${x}" eosld:y="${y}" eosld:lx="${x}" eosld:ly="${y}" eosld:w="${bayWidth}" eosld:h="${bayHeight}"/>${references}</Private>
      <ConductingEquipment name="QA1" type="CBR">
        ${sldAttributes({ x: x + 1, y: y + 2, lx: x + 2, ly: y + 3 })}
        <LNode iedName="P${n}" ldInst="LD0" lnClass="XCBR" lnInst="1"/>
        <LNode iedName="C${n}" ldInst="LD0" lnClass="CSWI" lnInst="1"/>
      </ConductingEquipment>
      <ConductingEquipment name="QB1" type="DIS">
        ${sldAttributes({ x: x + 1, y: y + 4, lx: x + 2, ly: y + 5 })}
        <LNode iedName="C${n}" ldInst="LD0" lnClass="XSWI" lnInst="1"/>
      </ConductingEquipment>
      <ConductingEquipment name="BA1" type="CTR">
        ${sldAttributes({ x: x + 1, y: y + 6, lx: x + 2, ly: y + 7 })}
        <LNode iedName="MU${n}" ldInst="LD0" lnClass="TCTR" lnInst="1"/>
      </ConductingEquipment>
    </Bay>`;
}

function server(ldInst: string, ln0Content: string, lns = ''): string {
  return `<AccessPoint name="AP1"><Server><Authentication/><LDevice inst="${ldInst}"><LN0 lnClass="LLN0" inst="" lnType="LLN0">${ln0Content}</LN0>${lns}</LDevice></Server></AccessPoint>`;
}

function ied(
  name: string,
  kind: keyof typeof manufacturers,
  content: string,
): string {
  const { manufacturer, type } = manufacturers[kind];
  return `<IED name="${name}" manufacturer="${manufacturer}" type="${type}" desc="${kind} ${name}">${content}</IED>`;
}

function gooseExtRefs(publisher: string, prefix = ''): string {
  return [
    ['PTRC', '1', 'Tr', 'general'],
    ['PTRC', '1', 'Tr', 'q'],
  ]
    .map(
      ([lnClass, lnInst, doName, daName], i) =>
        `<ExtRef iedName="${publisher}" ldInst="LD0" lnClass="${lnClass}" lnInst="${lnInst}" doName="${doName}" daName="${daName}" serviceType="GOOSE" srcLDInst="LD0" srcLNClass="LLN0" srcCBName="Trip" intAddr="${prefix}${publisher}Trip${i + 1}" desc="${publisher} trip ${daName}"/>`,
    )
    .join('');
}

function svExtRefs(publisher: string): string {
  return [
    ['TCTR', '1', 'AmpSv', 'instMag.i'],
    ['TCTR', '1', 'AmpSv', 'q'],
    ['TVTR', '1', 'VolSv', 'instMag.i'],
    ['TVTR', '1', 'VolSv', 'q'],
  ]
    .map(
      ([lnClass, lnInst, doName, daName]) =>
        `<ExtRef iedName="${publisher}" ldInst="LD0" lnClass="${lnClass}" lnInst="${lnInst}" doName="${doName}" daName="${daName}" serviceType="SMV" srcLDInst="LD0" srcLNClass="LLN0" srcCBName="MSVCB01" intAddr="${publisher}${lnClass}${daName}"/>`,
    )
    .join('');
}

function lgos(inst: number, publisher: string): string {
  return `<LN lnClass="LGOS" inst="${inst}" lnType="LGOS"><DOI name="GoCBRef" desc="Supervision of ${publisher}"><DAI name="setSrcRef"><Val>${publisher}LD0/LLN0.Trip</Val></DAI></DOI></LN>`;
}

function lsvs(inst: number, publisher: string): string {
  return `<LN lnClass="LSVS" inst="${inst}" lnType="LSVS"><DOI name="SvCBRef"><DAI name="setSrcRef"><Val>${publisher}LD0/LLN0.MSVCB01</Val></DAI></DOI></LN>`;
}

const tripDataSet = `<DataSet name="dsTrip"><FCDA ldInst="LD0" lnClass="PTRC" lnInst="1" doName="Tr" daName="general" fc="ST"/><FCDA ldInst="LD0" lnClass="PTRC" lnInst="1" doName="Tr" daName="q" fc="ST"/></DataSet>`;

const svDataSet = `<DataSet name="dsSv"><FCDA ldInst="LD0" lnClass="TCTR" lnInst="1" doName="AmpSv" daName="instMag.i" fc="MX"/><FCDA ldInst="LD0" lnClass="TCTR" lnInst="1" doName="AmpSv" daName="q" fc="MX"/><FCDA ldInst="LD0" lnClass="TVTR" lnInst="1" doName="VolSv" daName="instMag.i" fc="MX"/><FCDA ldInst="LD0" lnClass="TVTR" lnInst="1" doName="VolSv" daName="q" fc="MX"/></DataSet>`;

const measDataSet = `<DataSet name="dsMeas"><FCDA ldInst="LD0" lnClass="MMXU" lnInst="1" doName="TotW" fc="MX"/></DataSet>`;

const lnDescriptions = `<LN lnClass="PTRC" inst="1" lnType="PTRC" desc="Trip conditioning"><DOI name="Tr" desc="Trip"/></LN><LN lnClass="TCTR" inst="1" lnType="TCTR" desc="Current transformer"/><LN lnClass="TVTR" inst="1" lnType="TVTR" desc="Voltage transformer"/><LN lnClass="MMXU" inst="1" lnType="MMXU"/>`;

function protectionIed(n: number): string {
  const ln0 = `${tripDataSet}<Inputs>${svExtRefs(`MU${n}`)}</Inputs><GSEControl name="Trip" datSet="dsTrip" confRev="1" appID="P${n}Trip"/>`;
  return ied(`P${n}`, 'P', server('LD0', ln0, lnDescriptions + lsvs(1, `MU${n}`)));
}

function mergingUnit(n: number): string {
  const ln0 = `${svDataSet}<SampledValueControl name="MSVCB01" datSet="dsSv" confRev="1" smvID="MU${n}SV01" multicast="true" smpRate="80" nofASDU="1"><SmvOpts refreshTime="true" sampleSynchronized="true"/></SampledValueControl>`;
  return ied(`MU${n}`, 'MU', server('LD0', ln0, lnDescriptions));
}

function bayController(n: number): string {
  const ln0 = `${measDataSet}<ReportControl name="brcbMeas" datSet="dsMeas" confRev="1" buffered="true" rptID="C${n}Meas"><TrgOps dchg="true"/><OptFields seqNum="true"/><RptEnabled max="1"><ClientLN iedName="GW" ldInst="LD0" lnClass="ITCI" lnInst="1" desc="Gateway"/></RptEnabled></ReportControl><Inputs>${gooseExtRefs(`P${n}`)}</Inputs>`;
  return ied(`C${n}`, 'C', server('LD0', ln0, lnDescriptions + lgos(1, `P${n}`)));
}

function busbarProtection(bays: number): string {
  const extRefs = Array.from(
    { length: bays },
    (_, i) => svExtRefs(`MU${i + 1}`) + gooseExtRefs(`P${i + 1}`, 'BBP'),
  ).join('');
  const supervision = Array.from(
    { length: bays },
    (_, i) => lsvs(i + 1, `MU${i + 1}`) + lgos(i + 1, `P${i + 1}`),
  ).join('');
  return ied(
    'BBP',
    'BBP',
    server('LD0', `<Inputs>${extRefs}</Inputs>`, supervision),
  );
}

function gateway(): string {
  return ied(
    'GW',
    'GW',
    server('LD0', '', '<LN lnClass="ITCI" inst="1" lnType="ITCI"/>'),
  );
}

function gseAddress(n: number): string {
  return `<GSE ldInst="LD0" cbName="Trip"><Address><P type="MAC-Address">${mac('01-0C-CD-01', n)}</P><P type="APPID">${hex(0x1000 + n, 4)}</P><P type="VLAN-ID">${hex(0x100 + (n % 3), 3)}</P><P type="VLAN-PRIORITY">${4 + (n % 2)}</P></Address><MinTime unit="s" multiplier="m">4</MinTime><MaxTime unit="s" multiplier="m">1000</MaxTime></GSE>`;
}

function smvAddress(n: number): string {
  return `<SMV ldInst="LD0" cbName="MSVCB01"><Address><P type="MAC-Address">${mac('01-0C-CD-04', n)}</P><P type="APPID">${hex(0x4000 + n, 4)}</P><P type="VLAN-ID">${hex(0x200 + (n % 2), 3)}</P><P type="VLAN-PRIORITY">6</P></Address></SMV>`;
}

const lnClasses = [
  'LLN0',
  'PTRC',
  'TCTR',
  'TVTR',
  'MMXU',
  'LGOS',
  'LSVS',
  'ITCI',
];

/** Minimal schema-valid templates: one `Beh` data object per LN type. */
const dataTypeTemplates = `<DataTypeTemplates>${lnClasses
  .map(
    lnClass =>
      `<LNodeType id="${lnClass}" lnClass="${lnClass}"><DO name="Beh" type="ENS"/></LNodeType>`,
  )
  .join(
    '',
  )}<DOType id="ENS" cdc="ENS"><DA name="stVal" bType="BOOLEAN" fc="ST"/></DOType></DataTypeTemplates>`;

function connectedAp(iedName: string, content = ''): string {
  return `<ConnectedAP iedName="${iedName}" apName="AP1">${content}</ConnectedAP>`;
}

function communication(bays: number): string {
  const station: string[] = [];
  const process: string[] = [];
  for (let n = 1; n <= bays; n += 1) {
    station.push(connectedAp(`P${n}`, gseAddress(n)), connectedAp(`C${n}`));
    process.push(connectedAp(`MU${n}`, smvAddress(n)));
  }
  station.push(connectedAp('BBP'), connectedAp('GW'));
  return `<Communication><SubNetwork name="StationBus" type="8-MMS">${station.join('')}</SubNetwork><SubNetwork name="ProcessBus" type="8-MMS">${process.join('')}</SubNetwork></Communication>`;
}

/** Generates an SCL document string. */
export function generateScd(options: GenerateScdOptions = {}): string {
  const bays = options.bays ?? 4;
  const baysPerRow = options.baysPerRow ?? 4;
  const rows = Math.ceil(bays / baysPerRow);
  const columns = Math.min(bays, baysPerRow);

  const vlWidth = columns * (bayWidth + 1) + 1;
  const stationRowHeight = 4;
  const vlHeight = rows * (bayHeight + 1) + 1 + stationRowHeight;

  const bayXml = Array.from({ length: bays }, (_, i) => {
    const x = 2 + (i % baysPerRow) * (bayWidth + 1);
    const y = 2 + Math.floor(i / baysPerRow) * (bayHeight + 1);
    return bay(i, x, y);
  }).join('');

  const stationY = 2 + rows * (bayHeight + 1);
  const stationReferences =
    iedReference('BBP', 3, stationY) + iedReference('GW', 7, stationY);

  const ieds = [
    ...Array.from({ length: bays }, (_, i) => [
      protectionIed(i + 1),
      mergingUnit(i + 1),
      bayController(i + 1),
    ]).flat(),
    busbarProtection(bays),
    gateway(),
  ].join('\n  ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<SCL xmlns="http://www.iec.ch/61850/2003/SCL" xmlns:eosld="https://openscd.org/SCL/SSD/SLD/v0" version="2007" revision="B" release="4">
  <Header id="oscd-editor-map-communication sample"/>
  <Substation name="AA1">
    <Private type="OpenSCD-SLD-Layout"><eosld:SLDAttributes eosld:w="${vlWidth + 2}" eosld:h="${vlHeight + 2}"/></Private>
    <VoltageLevel name="E1">
      <Private type="OpenSCD-SLD-Layout"><eosld:SLDAttributes eosld:x="1" eosld:y="1" eosld:lx="1" eosld:ly="1" eosld:w="${vlWidth}" eosld:h="${vlHeight}"/>${stationReferences}</Private>
      ${bayXml}
    </VoltageLevel>
  </Substation>
  ${communication(bays)}
  ${ieds}
  ${dataTypeTemplates}
</SCL>
`;
}
