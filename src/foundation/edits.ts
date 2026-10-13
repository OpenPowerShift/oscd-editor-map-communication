import type { EditV2 } from '@openscd/oscd-api';
import { unsubscribe } from '@openscd/scl-lib';

/**
 * Edits removing inputs of a connection:
 * - `ClientLN` elements are removed from their report control block
 * - `ExtRef` elements are unsubscribed with `@openscd/scl-lib`, which keeps
 *   ExtRefs used for later binding (`intAddr`), removes emptied `Inputs` and
 *   removes subscription supervision no longer needed
 */
export function removeInputsEdits(inputs: Element[]): EditV2[] {
  const clientLns = inputs
    .filter(input => input.tagName === 'ClientLN')
    .map(node => ({ node }));
  const extRefs = inputs.filter(input => input.tagName === 'ExtRef');
  return [...clientLns, ...(extRefs.length > 0 ? unsubscribe(extRefs) : [])];
}
