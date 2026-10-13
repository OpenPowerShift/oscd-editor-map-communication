const equipmentSelector = 'ConductingEquipment, PowerTransformer';

/**
 * Returns the primary equipment within `scope` that has an `LNode` allocated
 * to the named IED.
 */
export function linkedEquipment(scope: Element, iedName: string): Element[] {
  const equipment = new Set<Element>();
  scope.querySelectorAll(`LNode[iedName="${iedName}"]`).forEach((lNode) => {
    const owner = lNode.closest(equipmentSelector);
    if (owner) {
      equipment.add(owner);
    }
  });
  return Array.from(equipment);
}
