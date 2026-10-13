import type { CommParams } from './types.js';

/**
 * Indexes every `GSE` and `SMV` address in the Communication section in one
 * pass, keyed by IED name, access point, logical device and control block
 * name. This replaces a document-wide query per control block.
 */
export function commAddressIndex(doc: XMLDocument): Map<string, Element> {
  const index = new Map<string, Element>();
  doc
    .querySelectorAll(
      ':root > Communication > SubNetwork > ConnectedAP > GSE, :root > Communication > SubNetwork > ConnectedAP > SMV',
    )
    .forEach((address) => {
      const connectedAp = address.parentElement!;
      const key = addressKey(
        address.tagName,
        connectedAp.getAttribute('iedName'),
        connectedAp.getAttribute('apName'),
        address.getAttribute('ldInst'),
        address.getAttribute('cbName'),
      );
      if (!index.has(key)) {
        index.set(key, address);
      }
    });
  return index;
}

function addressKey(
  tag: string,
  iedName: string | null,
  apName: string | null,
  ldInst: string | null,
  cbName: string | null,
): string {
  return [tag, iedName, apName, ldInst, cbName].join('|');
}

/**
 * Finds the `GSE`/`SMV` address of a GOOSE or SV control block, also looking
 * at access points that serve this one through `ServerAt`. Mirrors
 * `controlBlockGseOrSmv` from `@openscd/scl-lib` but uses a prebuilt index.
 */
export function findCommAddress(
  controlBlock: Element,
  index: Map<string, Element>,
): Element | null {
  const tag =
    controlBlock.tagName === 'GSEControl'
      ? 'GSE'
      : controlBlock.tagName === 'SampledValueControl'
        ? 'SMV'
        : null;
  const ied = controlBlock.closest('IED');
  const apName = controlBlock.closest('AccessPoint')?.getAttribute('name');
  const ldInst = controlBlock.closest('LDevice')?.getAttribute('inst');
  if (tag === null || !ied || !apName || !ldInst) {
    return null;
  }

  const serverAtApNames = Array.from(
    ied.querySelectorAll(`:scope > AccessPoint > ServerAt[apName="${apName}"]`),
  ).map(serverAt => serverAt.parentElement!.getAttribute('name'));

  const iedName = ied.getAttribute('name');
  const cbName = controlBlock.getAttribute('name');
  for (const ap of [apName, ...serverAtApNames]) {
    const address = index.get(addressKey(tag, iedName, ap, ldInst, cbName));
    if (address) {
      return address;
    }
  }
  return null;
}

/** Reads the communication parameters of a `GSE` or `SMV` address element. */
export function readCommParams(address: Element | null): CommParams {
  if (!address) {
    return {};
  }
  const param = (type: string) =>
    address
      .querySelector(`:scope > Address > P[type="${type}"]`)
      ?.textContent?.trim() || undefined;
  const time = (tag: string) =>
    address.querySelector(`:scope > ${tag}`)?.textContent?.trim() || undefined;

  const params: CommParams = {
    vlanId: param('VLAN-ID'),
    vlanPriority: param('VLAN-PRIORITY'),
    appId: param('APPID'),
    macAddress: param('MAC-Address'),
    minTime: time('MinTime'),
    maxTime: time('MaxTime'),
  };
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined),
  );
}

/** Splits comma separated user input into trimmed, non-empty tokens. */
export function parseCsvTokens(text: string): string[] {
  return text
    .split(',')
    .map(token => token.trim())
    .filter(token => token !== '');
}

/**
 * Parses a VLAN identifier as stored in SCL. SCL stores the VLAN-ID as
 * hexadecimal without a `0x` prefix; an explicit `0x` prefix is also accepted.
 */
export function parseVlanRaw(text: string | null | undefined): number | null {
  const value = text?.trim() ?? '';
  const match = /^(?:0x)?([0-9a-f]+)$/i.exec(value);
  return match ? Number.parseInt(match[1], 16) : null;
}

/**
 * Parses a VLAN identifier typed by a user: decimal unless prefixed with `0x`
 * or containing a hexadecimal letter.
 */
export function parseVlanToken(text: string | null | undefined): number | null {
  const value = text?.trim() ?? '';
  return (
    parsePriority(value) ??
    (/^[0-9a-f]+$/i.test(value) ? Number.parseInt(value, 16) : null)
  );
}

/** Parses a VLAN priority (decimal, or hexadecimal with `0x`). */
export function parsePriority(text: string | null | undefined): number | null {
  const value = text?.trim() ?? '';
  if (/^0x[0-9a-f]+$/i.test(value)) {
    return Number.parseInt(value.slice(2), 16);
  }
  if (/^[0-9]+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  return null;
}

/** Formats a VLAN identifier as three hexadecimal digits, `0x065`. */
export function formatVlanId(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(3, '0')}`;
}

/** Formats a raw SCL VLAN identifier as `0x065 (101)`. */
export function formatVlan(raw: string): string {
  const value = parseVlanRaw(raw);
  return value === null ? raw : `${formatVlanId(value)} (${value})`;
}
