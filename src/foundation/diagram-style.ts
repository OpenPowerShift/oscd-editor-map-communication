/** A CSS attribute selector matching an element id exactly. */
function idSelector(id: string): string {
  return `[id=${JSON.stringify(id)}]`;
}

/**
 * CSS for the SLD viewer's shadow root that fades the primary diagram
 * (equipment, wiring, bays, voltage levels and their labels) so the IEDs and
 * connections stand out. IED symbols, the labels of the given IEDs and the
 * elements with the given ids (highlighted equipment) keep full strength.
 *
 * The viewer nests IEDs and equipment inside bay and voltage level groups,
 * so groups cannot be faded as a whole (their opacity would apply to the
 * IEDs too). Instead every drawn shape outside IED groups and symbol
 * definitions is faded. That rule has no specificity, so the rules keeping
 * labels and highlights at full strength always win.
 */
export function fadeRules(ieds: string[], keep: string[] = []): string {
  const kept = [...ieds.map(name => `label:${name}`), ...keep].map(
    id => `#sld g${idSelector(id)} *`,
  );
  return [
    ':where(#sld g:not(.ied):not(defs *)) > :where(:not(g, title)) {',
    '  opacity: var(--oscd-map-diagram-opacity, 0.7);',
    '}',
    kept.length > 0 ? `${kept.join(',\n')} { opacity: 1; }` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
