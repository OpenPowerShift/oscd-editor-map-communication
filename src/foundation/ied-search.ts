/** An IED that can be found on a diagram. */
export interface SearchableIed {
  name: string;
  /** Name of the substation whose diagram places the IED. */
  substation: string;
  desc?: string;
}

/**
 * How well a name matches a query (lower is better): 0 exact, 1 starts with
 * it, 2 one of the name's parts (split at `_`, `-`, `.`, spaces or case
 * changes) starts with it, 3 contains it, 4 only the description contains
 * it; `undefined` when it does not match. Case is ignored.
 */
export function matchRank(
  { name, desc = '' }: SearchableIed,
  query: string,
): number | undefined {
  const q = query.trim().toLowerCase();
  if (q === '') {
    return undefined;
  }
  const lower = name.toLowerCase();
  if (lower === q) {
    return 0;
  }
  if (lower.startsWith(q)) {
    return 1;
  }
  const parts = name
    .split(/[\s_.-]+|(?<=[a-z])(?=[A-Z])/)
    .map(part => part.toLowerCase());
  if (parts.some(part => part.startsWith(q))) {
    return 2;
  }
  if (lower.includes(q)) {
    return 3;
  }
  return desc.toLowerCase().includes(q) ? 4 : undefined;
}

/**
 * IEDs matching a query, best first: by match rank, then IEDs on the
 * substation shown, then by name.
 */
export function searchIeds(
  ieds: SearchableIed[],
  query: string,
  shownSubstation?: string,
  limit = 8,
): SearchableIed[] {
  return ieds
    .map(ied => ({ ied, rank: matchRank(ied, query) }))
    .filter((match): match is { ied: SearchableIed; rank: number } =>
      match.rank !== undefined,
    )
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        Number(b.ied.substation === shownSubstation) -
          Number(a.ied.substation === shownSubstation) ||
        a.ied.name.localeCompare(b.ied.name, undefined, { numeric: true }),
    )
    .slice(0, limit)
    .map(({ ied }) => ied);
}
