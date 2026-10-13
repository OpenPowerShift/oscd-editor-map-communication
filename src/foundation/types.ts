/** The kind of communication a connection represents. */
export type Service = 'GOOSE' | 'SV' | 'Report';

export const services: Service[] = ['GOOSE', 'SV', 'Report'];

/** Communication parameters of a GOOSE or SV control block's address. */
export interface CommParams {
  /** VLAN identifier as stored in SCL (hexadecimal, e.g. `"065"`). */
  vlanId?: string;
  vlanPriority?: string;
  appId?: string;
  macAddress?: string;
  minTime?: string;
  maxTime?: string;
}

/** One end of a connection. */
export interface Endpoint {
  /** The SCL `IED` element. */
  ied: Element;
  /** The IED's name. */
  name: string;
  /**
   * The SLD `Reference type="IED"` element placing this IED on a diagram, or
   * `null` when the IED is not placed.
   */
  reference: Element | null;
}

/**
 * Data flowing from one control block to one subscribing (or client) IED.
 * All inputs of the target IED fed by the same control block are grouped.
 */
export interface Connection {
  /** Stable identifier: control block identity and target IED name. */
  id: string;
  service: Service;
  /** `GSEControl`, `SampledValueControl` or `ReportControl`. */
  controlBlock: Element;
  /** Communication parameters (empty for reports). */
  comm: CommParams;
  source: Endpoint;
  target: Endpoint;
  /** `ExtRef` elements (GOOSE/SV) or `ClientLN` elements (Report). */
  inputs: Element[];
}
