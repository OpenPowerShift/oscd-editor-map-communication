import { identity } from '@openscd/scl-lib';
import { iedReferences, sldNs } from '@omicronenergy/oscd-editor-sld/foundations.js';

import { commAddressIndex, findCommAddress, readCommParams } from './comm-params.js';
import type { CommParams, Connection, Endpoint, Service } from './types.js';

const lDevicePath = ':root > IED > AccessPoint > Server > LDevice';

/**
 * Maps IED names to the SLD `Reference type="IED"` elements placing them on a
 * diagram. A reference's `id` is the IED's identity, which is its name. The
 * first reference wins if an IED is placed more than once.
 */
export function iedReferenceMap(doc: XMLDocument): Map<string, Element> {
  const map = new Map<string, Element>();
  iedReferences(doc).forEach((reference) => {
    const id = reference.getAttributeNS(sldNs, 'id');
    if (id && !map.has(id)) {
      map.set(id, reference);
    }
  });
  return map;
}

function serviceOf(controlBlock: Element): Service {
  if (controlBlock.tagName === 'GSEControl') {
    return 'GOOSE';
  }
  if (controlBlock.tagName === 'SampledValueControl') {
    return 'SV';
  }
  return 'Report';
}

/** `serviceType` values an ExtRef may carry for a given control block kind. */
const extRefServiceTypes: Record<string, string> = {
  GSEControl: 'GOOSE',
  SampledValueControl: 'SMV',
};

function extRefKey(
  iedName: string,
  ldInst: string,
  prefix: string,
  lnClass: string,
  lnInst: string,
  cbName: string,
): string {
  return [iedName, ldInst, prefix, lnClass, lnInst, cbName].join('|');
}

/**
 * Indexes every ExtRef naming a source control block (`srcCBName`, Edition 2)
 * by the control block it refers to. `srcLDInst` falls back to `ldInst` and
 * `srcLNClass` to `LLN0`, as in IEC 61850-6.
 */
function indexExtRefs(doc: XMLDocument): Map<string, Element[]> {
  const index = new Map<string, Element[]>();
  doc
    .querySelectorAll(
      `${lDevicePath} > LN0 > Inputs > ExtRef[srcCBName], ${lDevicePath} > LN > Inputs > ExtRef[srcCBName]`,
    )
    .forEach((extRef) => {
      const iedName = extRef.getAttribute('iedName');
      const ldInst =
        extRef.getAttribute('srcLDInst') ?? extRef.getAttribute('ldInst');
      if (!iedName || !ldInst) {
        return;
      }
      const key = extRefKey(
        iedName,
        ldInst,
        extRef.getAttribute('srcPrefix') ?? '',
        extRef.getAttribute('srcLNClass') ?? 'LLN0',
        extRef.getAttribute('srcLNInst') ?? '',
        extRef.getAttribute('srcCBName')!,
      );
      const bucket = index.get(key);
      if (bucket) {
        bucket.push(extRef);
      } else {
        index.set(key, [extRef]);
      }
    });
  return index;
}

function controlBlockKey(iedName: string, controlBlock: Element): string {
  const anyLn = controlBlock.parentElement!;
  return extRefKey(
    iedName,
    controlBlock.closest('LDevice')?.getAttribute('inst') ?? '',
    anyLn.getAttribute('prefix') ?? '',
    anyLn.getAttribute('lnClass') ?? '',
    anyLn.getAttribute('inst') ?? '',
    controlBlock.getAttribute('name') ?? '',
  );
}

function matchesServiceType(extRef: Element, controlBlock: Element): boolean {
  const serviceType = extRef.getAttribute('serviceType');
  return (
    serviceType === null ||
    serviceType === extRefServiceTypes[controlBlock.tagName]
  );
}

/** Groups inputs by the IED they live in (ExtRef) or name (ClientLN). */
function groupByTarget(
  inputs: Element[],
  targetName: (input: Element) => string | null,
): Map<string, Element[]> {
  const groups = new Map<string, Element[]>();
  inputs.forEach((input) => {
    const name = targetName(input);
    if (!name) {
      return;
    }
    const group = groups.get(name);
    if (group) {
      group.push(input);
    } else {
      groups.set(name, [input]);
    }
  });
  return groups;
}

/**
 * Builds every connection in the document in a single pass over control
 * blocks, ExtRefs and ClientLNs:
 * - GOOSE / SV: `GSEControl` / `SampledValueControl` in `LN0` matched against
 *   subscribing `ExtRef` elements (Edition 2 `src*` attributes)
 * - Report: `ReportControl` (in `LN0` or `LN`) to each `ClientLN`
 *
 * Inputs are grouped per target IED. Targets that are not IEDs in this
 * document are ignored.
 */
export function buildConnections(doc: XMLDocument): Connection[] {
  const ieds = new Map<string, Element>();
  doc.querySelectorAll(':root > IED[name]').forEach((ied) => {
    ieds.set(ied.getAttribute('name')!, ied);
  });
  const references = iedReferenceMap(doc);
  const extRefs = indexExtRefs(doc);
  const addresses = commAddressIndex(doc);

  const endpoint = (name: string): Endpoint | null => {
    const ied = ieds.get(name);
    return ied ? { ied, name, reference: references.get(name) ?? null } : null;
  };

  const connections: Connection[] = [];
  const addConnections = (
    controlBlock: Element,
    source: Endpoint,
    groups: Map<string, Element[]>,
    comm: CommParams,
  ) => {
    const cbIdentity = identity(controlBlock);
    groups.forEach((inputs, targetName) => {
      const target = endpoint(targetName);
      if (!target) {
        return;
      }
      connections.push({
        id: `${cbIdentity}→${targetName}`,
        service: serviceOf(controlBlock),
        controlBlock,
        comm,
        source,
        target,
        inputs,
      });
    });
  };

  doc
    .querySelectorAll(
      `${lDevicePath} > LN0 > GSEControl, ${lDevicePath} > LN0 > SampledValueControl, ${lDevicePath} > LN0 > ReportControl, ${lDevicePath} > LN > ReportControl`,
    )
    .forEach((controlBlock) => {
      const sourceName = controlBlock.closest('IED')!.getAttribute('name');
      const source = sourceName ? endpoint(sourceName) : null;
      if (!source) {
        return;
      }

      if (controlBlock.tagName === 'ReportControl') {
        const clientLns = Array.from(
          controlBlock.querySelectorAll(':scope > RptEnabled > ClientLN'),
        );
        addConnections(
          controlBlock,
          source,
          groupByTarget(clientLns, clientLn => clientLn.getAttribute('iedName')),
          {},
        );
        return;
      }

      const subscribers = (
        extRefs.get(controlBlockKey(source.name, controlBlock)) ?? []
      ).filter(extRef => matchesServiceType(extRef, controlBlock));
      if (subscribers.length === 0) {
        return;
      }
      addConnections(
        controlBlock,
        source,
        groupByTarget(subscribers, extRef =>
          extRef.closest('IED')!.getAttribute('name'),
        ),
        readCommParams(findCommAddress(controlBlock, addresses)),
      );
    });

  return connections;
}
