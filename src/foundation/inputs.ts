import {
  controlBlockObjRef,
  identity,
  matchDataAttributes,
} from '@openscd/scl-lib';

import type { Connection } from './types.js';

/** Descriptions found along the instantiated data path of an FCDA. */
export interface FcdaDescriptions {
  LDevice?: string;
  LN?: string;
  DOI?: string;
  SDI?: string[];
  DAI?: string;
}

/** A human readable reference and description for one side of an input. */
export interface InputText {
  reference: string;
  desc?: string;
}

/** True when an ExtRef is bound to source data (or is a ClientLN). */
export function isBound(input: Element): boolean {
  if (input.tagName === 'ClientLN') {
    return true;
  }
  return ['iedName', 'ldInst', 'lnClass', 'doName'].every(attr =>
    input.hasAttribute(attr),
  );
}

function descOrValue(element: Element): string | undefined {
  return (
    element.getAttribute('desc') ||
    element.querySelector(':scope > DAI[name="d"] > Val')?.textContent ||
    undefined
  );
}

/**
 * Collects the `desc` (or `d` value) of the LDevice, LN, DOI, SDIs and DAI an
 * FCDA points to in its own IED.
 */
export function fcdaDescriptions(fcda: Element): FcdaDescriptions {
  const ied = fcda.closest('IED');
  const ldInst = fcda.getAttribute('ldInst');
  if (!ied || !ldInst) {
    return {};
  }
  const lDevice = ied.querySelector(
    `:scope > AccessPoint > Server > LDevice[inst="${ldInst}"]`,
  );
  const anyLn = Array.from(
    lDevice?.querySelectorAll(':scope > LN0, :scope > LN') ?? [],
  ).find(
    ln =>
      (ln.getAttribute('prefix') ?? '') === (fcda.getAttribute('prefix') ?? '') &&
      ln.getAttribute('lnClass') === fcda.getAttribute('lnClass') &&
      (ln.getAttribute('inst') ?? '') === (fcda.getAttribute('lnInst') ?? ''),
  );
  if (!lDevice || !anyLn) {
    return {};
  }

  const descs: FcdaDescriptions = {};
  const ldDesc = lDevice.getAttribute('desc');
  if (ldDesc) {
    descs.LDevice = ldDesc;
  }
  const lnDesc = anyLn.getAttribute('desc');
  if (lnDesc) {
    descs.LN = lnDesc;
  }

  const [doName, ...sdoNames] = (fcda.getAttribute('doName') ?? '').split('.');
  const daNames = fcda.getAttribute('daName')?.split('.') ?? [];
  const doi = anyLn.querySelector(`:scope > DOI[name="${doName}"]`);
  if (!doi) {
    return descs;
  }
  const doiDesc = descOrValue(doi);
  if (doiDesc) {
    descs.DOI = doiDesc;
  }

  let parent = doi;
  const sdiDescs: string[] = [];
  for (const sdiName of [...sdoNames, ...daNames.slice(0, -1)]) {
    const sdi = parent.querySelector(`:scope > SDI[name="${sdiName}"]`);
    if (!sdi) {
      break;
    }
    parent = sdi;
    const sdiDesc = descOrValue(sdi);
    if (sdiDesc) {
      sdiDescs.push(sdiDesc);
    }
  }
  if (sdiDescs.length > 0) {
    descs.SDI = sdiDescs;
  }

  const daName = daNames[daNames.length - 1];
  const daiDesc = daName
    ? parent
      .querySelector(`:scope > DAI[name="${daName}"]`)
      ?.getAttribute('desc')
    : undefined;
  if (daiDesc) {
    descs.DAI = daiDesc;
  }
  return descs;
}

/**
 * Describes the source data of an input. For an ExtRef the FCDA in the
 * control block's data set is looked up to add its instance descriptions.
 */
export function inputSource(input: Element, controlBlock: Element): InputText {
  const ln = `${input.getAttribute('prefix') ?? ''}${input.getAttribute('lnClass') ?? ''}${input.getAttribute('lnInst') ?? ''}`;
  if (input.tagName === 'ClientLN') {
    return { reference: ln };
  }

  const daName = input.getAttribute('daName');
  const reference = `${input.getAttribute('ldInst') ?? ''}/${ln}.${input.getAttribute('doName') ?? ''}${daName ? `.${daName}` : ''}`;

  const dataSetName = controlBlock.getAttribute('datSet');
  const fcda = dataSetName
    ? Array.from(
      controlBlock.parentElement?.querySelectorAll(
        `:scope > DataSet[name="${dataSetName}"] > FCDA`,
      ) ?? [],
    ).find(candidate => matchDataAttributes(input, candidate))
    : undefined;
  if (!fcda) {
    return { reference };
  }
  const desc = Object.values(fcdaDescriptions(fcda)).flat().join(' > ');
  return desc ? { reference, desc } : { reference };
}

/** Describes the receiving side of an input: its `intAddr` or identity. */
export function inputDestination(input: Element): InputText {
  const desc = input.getAttribute('desc') || undefined;
  if (input.tagName === 'ClientLN') {
    return { reference: desc ?? `${identity(input)}` };
  }
  const reference = input.getAttribute('intAddr') || `${identity(input)}`;
  return desc ? { reference, desc } : { reference };
}

/**
 * Finds the subscriber's supervision LN (`LGOS` for GOOSE, `LSVS` for SV)
 * whose `setSrcRef` points to the control block.
 */
export function existingSupervision(
  controlBlock: Element,
  subscriber: Element,
): Element | null {
  const supervision: Record<string, [string, string]> = {
    GSEControl: ['LGOS', 'GoCBRef'],
    SampledValueControl: ['LSVS', 'SvCBRef'],
  };
  const kind = supervision[controlBlock.tagName];
  if (!kind) {
    return null;
  }
  const [lnClass, doName] = kind;
  const objRef = controlBlockObjRef(controlBlock);
  const value = Array.from(
    subscriber.querySelectorAll(
      `:scope > AccessPoint > Server > LDevice > LN[lnClass="${lnClass}"] > DOI[name="${doName}"] > DAI[name="setSrcRef"] > Val`,
    ),
  ).find(val => val.textContent?.trim() === objRef);
  return value?.closest('LN') ?? null;
}

/** Short title of a connection: `source:controlBlock ⮕ target`. */
export function connectionTitle(connection: Connection): string {
  return `${connection.source.name}:${connection.controlBlock.getAttribute('name') ?? ''} ⮕ ${connection.target.name}`;
}

function inputLine(input: Element, controlBlock: Element): string {
  const describe = ({ reference, desc }: InputText) =>
    desc ? `${reference} (${desc})` : reference;
  return `${describe(inputSource(input, controlBlock))} ⮕ ${describe(inputDestination(input))}`;
}

/** Multi-line tooltip: the title followed by one line per bound input. */
export function connectionTooltip(connection: Connection): string {
  const lines = connection.inputs
    .filter(isBound)
    .map(input => `  ${inputLine(input, connection.controlBlock)}`);
  return [connectionTitle(connection), ...lines].join('\n');
}
