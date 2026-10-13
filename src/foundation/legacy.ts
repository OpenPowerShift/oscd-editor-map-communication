import { iedReferences } from '@omicronenergy/oscd-editor-sld/foundations.js';

/** Namespace of the deprecated attribute based SLD layout format. */
const legacySldNs = 'https://transpower.co.nz/SCL/SSD/SLD/v0';

/**
 * True when the document still uses the deprecated SLD layout format and has
 * no IEDs placed in the current format, so it has to be converted with the SLD
 * editor before it can be mapped.
 */
export function hasLegacySldLayout(doc: XMLDocument): boolean {
  const usesLegacyFormat =
    doc.getElementsByTagNameNS(legacySldNs, '*').length > 0 ||
    Array.from(doc.querySelectorAll(':root > Substation')).some(substation =>
      Array.from(substation.attributes).some(
        attribute => attribute.namespaceURI === legacySldNs,
      ),
    );
  return usesLegacyFormat && iedReferences(doc).length === 0;
}
