import {
  parseCsvTokens,
  parsePriority,
  parseVlanRaw,
  parseVlanToken,
} from './comm-params.js';
import { services, type Connection, type Service } from './types.js';

/** Which connections are shown. */
export interface ConnectionFilter {
  /** Services shown. */
  services: Service[];
  /** Name of the selected IED: only its connections are shown. */
  ied?: string;
  /** With an IED selected: show connections it receives. */
  incoming: boolean;
  /** With an IED selected: show connections it sends. */
  outgoing: boolean;
  /** Space separated terms; a source IED name must contain one of them. */
  sourceIed: string;
  /** Space separated terms; a target IED name must contain one of them. */
  targetIed: string;
  /** Space separated terms; a control block name must contain one of them. */
  controlBlock: string;
  /** VLAN identifiers (numeric) of GOOSE and SV connections shown. */
  vlans: number[];
  /** VLAN priorities of GOOSE and SV connections shown. */
  priorities: number[];
  /** `manufacturer|type` keys; a source or target IED must match one. */
  types: string[];
}

export function emptyFilter(): ConnectionFilter {
  return {
    services: [...services],
    incoming: true,
    outgoing: true,
    sourceIed: '',
    targetIed: '',
    controlBlock: '',
    vlans: [],
    priorities: [],
    types: [],
  };
}

/** Shows a hidden service or hides a shown one, keeping the services' order. */
export function toggleService(shown: Service[], service: Service): Service[] {
  return shown.includes(service)
    ? shown.filter(s => s !== service)
    : services.filter(s => s === service || shown.includes(s));
}

/** True when any of the filter panel's criteria are set. */
export function isFilterActive(filter: ConnectionFilter): boolean {
  return (
    filter.sourceIed.trim() !== '' ||
    filter.targetIed.trim() !== '' ||
    filter.controlBlock.trim() !== '' ||
    filter.vlans.length > 0 ||
    filter.priorities.length > 0 ||
    filter.types.length > 0
  );
}

/**
 * How many of the filter panel's criteria are set: each name field, and the
 * VLAN, priority and manufacturer/type selections, count once.
 */
export function activeCriteria(filter: ConnectionFilter): number {
  return [
    filter.sourceIed.trim() !== '',
    filter.targetIed.trim() !== '',
    filter.controlBlock.trim() !== '',
    filter.vlans.length > 0,
    filter.priorities.length > 0,
    filter.types.length > 0,
  ].filter(Boolean).length;
}

/** Clears the filter panel's criteria, keeping services and IED selection. */
export function clearCriteria(filter: ConnectionFilter): ConnectionFilter {
  const empty = emptyFilter();
  return {
    ...filter,
    sourceIed: empty.sourceIed,
    targetIed: empty.targetIed,
    controlBlock: empty.controlBlock,
    vlans: empty.vlans,
    priorities: empty.priorities,
    types: empty.types,
  };
}

/** Key identifying an IED's manufacturer and type. */
function typeKey(ied: Element): string {
  return `${ied.getAttribute('manufacturer') ?? ''}|${ied.getAttribute('type') ?? ''}`;
}

function matchesTerms(value: string, terms: string): boolean {
  const tokens = terms.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return true;
  }
  const lower = value.toLowerCase();
  return tokens.some(token => lower.includes(token));
}

/**
 * VLAN and priority criteria only apply to GOOSE and SV, as reports carry no
 * VLAN: reports are not hidden by them.
 */
function matchesNumber(
  connection: Connection,
  selected: number[],
  value: number | null,
): boolean {
  if (selected.length === 0 || connection.service === 'Report') {
    return true;
  }
  return value !== null && selected.includes(value);
}

function matchesFilter(
  connection: Connection,
  filter: ConnectionFilter,
): boolean {
  const { source, target } = connection;
  if (!filter.services.includes(connection.service)) {
    return false;
  }
  if (filter.ied !== undefined) {
    const incoming = filter.incoming && target.name === filter.ied;
    const outgoing = filter.outgoing && source.name === filter.ied;
    if (!incoming && !outgoing) {
      return false;
    }
  }
  if (filter.types.length > 0) {
    const types = [typeKey(source.ied), typeKey(target.ied)];
    if (!types.some(key => filter.types.includes(key))) {
      return false;
    }
  }
  return (
    matchesTerms(source.name, filter.sourceIed) &&
    matchesTerms(target.name, filter.targetIed) &&
    matchesTerms(
      connection.controlBlock.getAttribute('name') ?? '',
      filter.controlBlock,
    ) &&
    matchesNumber(connection, filter.vlans, parseVlanRaw(connection.comm.vlanId)) &&
    matchesNumber(
      connection,
      filter.priorities,
      parsePriority(connection.comm.vlanPriority),
    )
  );
}

export function filterConnections(
  connections: Connection[],
  filter: ConnectionFilter,
): Connection[] {
  return connections.filter(connection => matchesFilter(connection, filter));
}

/** Values offered by the filter panel. */
export interface FilterOptions {
  vlans: number[];
  priorities: number[];
  /** Manufacturer name to its IED types, both sorted. */
  manufacturers: Map<string, string[]>;
  /** Connections offering each value. */
  counts: {
    vlans: Map<number, number>;
    priorities: Map<number, number>;
    /** By `manufacturer|type` key: connections from or to such an IED. */
    types: Map<string, number>;
  };
}

export function emptyOptions(): FilterOptions {
  return {
    vlans: [],
    priorities: [],
    manufacturers: new Map(),
    counts: { vlans: new Map(), priorities: new Map(), types: new Map() },
  };
}

/**
 * The part of a filter that decides which values the filter panel offers:
 * shown services and the selected IED with its directions. With an IED
 * selected, only what its own connections use is offered.
 */
export function scopeFilter(filter: ConnectionFilter): ConnectionFilter {
  const { services: shown, ied, incoming, outgoing } = filter;
  return { ...emptyFilter(), services: shown, ied, incoming, outgoing };
}

function increment<K>(counts: Map<K, number>, key: K): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/**
 * Values found in the given connections, with how many connections use
 * each. Values already selected in `selected` are always offered so they can
 * be cleared.
 */
export function filterOptions(
  connections: Connection[],
  selected?: ConnectionFilter,
): FilterOptions {
  const options = emptyOptions();
  const { counts } = options;
  const types = new Map<string, Set<string>>();
  const addType = (key: string) => {
    const [manufacturer, type] = key.split('|');
    if (!types.has(manufacturer)) {
      types.set(manufacturer, new Set());
    }
    types.get(manufacturer)!.add(type);
  };

  connections.forEach(({ comm, source, target }) => {
    const vlan = parseVlanRaw(comm.vlanId);
    if (vlan !== null) {
      increment(counts.vlans, vlan);
    }
    const priority = parsePriority(comm.vlanPriority);
    if (priority !== null) {
      increment(counts.priorities, priority);
    }
    new Set([typeKey(source.ied), typeKey(target.ied)]).forEach((key) => {
      increment(counts.types, key);
      addType(key);
    });
  });

  const vlans = new Set(counts.vlans.keys());
  const priorities = new Set(counts.priorities.keys());
  selected?.vlans.forEach(vlan => vlans.add(vlan));
  selected?.priorities.forEach(priority => priorities.add(priority));
  selected?.types.forEach(addType);

  const byNumber = (a: number, b: number) => a - b;
  options.vlans = Array.from(vlans).sort(byNumber);
  options.priorities = Array.from(priorities).sort(byNumber);
  options.manufacturers = new Map(
    Array.from(types.keys())
      .sort()
      .map(manufacturer => [
        manufacturer,
        Array.from(types.get(manufacturer)!).sort(),
      ]),
  );
  return options;
}

/**
 * Parses comma separated user input into the available values it names,
 * sorted and without duplicates. Unknown or invalid tokens are dropped.
 */
function parseSelection(
  text: string,
  available: number[],
  parse: (token: string) => number | null,
): number[] {
  const selected = new Set<number>();
  parseCsvTokens(text).forEach((token) => {
    const value = parse(token);
    if (value !== null && available.includes(value)) {
      selected.add(value);
    }
  });
  return Array.from(selected).sort((a, b) => a - b);
}

export function parseVlanSelection(text: string, available: number[]): number[] {
  return parseSelection(text, available, parseVlanToken);
}

export function parsePrioritySelection(
  text: string,
  available: number[],
): number[] {
  return parseSelection(text, available, parsePriority);
}

/** Adds or removes a value, keeping the selection sorted. */
export function toggleValue(selection: number[], value: number): number[] {
  return selection.includes(value)
    ? selection.filter(v => v !== value)
    : [...selection, value].sort((a, b) => a - b);
}
