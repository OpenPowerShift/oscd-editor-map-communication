/**
 * Exports the map as drawn: the single line diagram with the connections on
 * top, as a self-contained SVG, a PNG or a PDF.
 *
 * The diagram and the overlay are styled by stylesheets in shadow roots and
 * by theme variables, which a standalone file cannot see. Every exported
 * element therefore gets its computed presentation inlined, so the file
 * looks like the screen in any viewer.
 */

const svgNs = 'http://www.w3.org/2000/svg';

/** Presentation properties copied from the screen into the exported file. */
const presentation = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'shape-rendering',
];

/** Interaction-only parts of the diagram and overlay, left out of exports. */
const interactive = '.hit, .handle, .preview, .port, title, style';

/** What to export. */
export type ExportScope = 'diagram' | 'view';

export type ExportFormat = 'svg' | 'png' | 'pdf';

/** `[x, y, width, height]` in grid units. */
export type ViewBox = [number, number, number, number];

/**
 * Copies `source`'s computed presentation onto `clone`, recursively, and
 * drops what is hidden or only there for interaction. Both trees must have
 * the same shape.
 */
export function inlineStyles(source: Element, clone: Element): void {
  const style = getComputedStyle(source);
  const declarations = presentation
    .map(property => [property, style.getPropertyValue(property)])
    .filter(([, value]) => value !== '')
    .map(([property, value]) => `${property}: ${value}`);
  clone.setAttribute('style', declarations.join('; '));
  clone.removeAttribute('class');

  const sources = Array.from(source.children);
  const clones = Array.from(clone.children);
  sources.forEach((child, i) => {
    const copy = clones[i];
    const hidden = getComputedStyle(child);
    if (
      child.matches(interactive) ||
      hidden.display === 'none' ||
      hidden.visibility === 'hidden'
    ) {
      copy.remove();
      return;
    }
    inlineStyles(child, copy);
  });
}

/** A styled, standalone copy of a rendered SVG's content. */
function exportedGroup(svg: SVGSVGElement): SVGGElement {
  const group = document.createElementNS(svgNs, 'g');
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(svg, clone);
  group.setAttribute('style', clone.getAttribute('style') ?? '');
  group.append(...Array.from(clone.childNodes));
  return group;
}

/**
 * Builds a standalone SVG of the given layers (bottom first) drawn in one
 * coordinate system, cropped to `viewBox` and `scale` pixels per unit.
 */
export function composeSvg(
  layers: SVGSVGElement[],
  [x, y, width, height]: ViewBox,
  scale: number,
  background: string,
): string {
  const root = document.createElementNS(svgNs, 'svg');
  root.setAttribute('xmlns', svgNs);
  root.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  root.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
  root.setAttribute('width', `${Math.round(width * scale)}`);
  root.setAttribute('height', `${Math.round(height * scale)}`);
  const backdrop = document.createElementNS(svgNs, 'rect');
  backdrop.setAttribute('x', `${x}`);
  backdrop.setAttribute('y', `${y}`);
  backdrop.setAttribute('width', `${width}`);
  backdrop.setAttribute('height', `${height}`);
  backdrop.setAttribute('fill', background);
  root.append(backdrop, ...layers.map(exportedGroup));
  return new XMLSerializer().serializeToString(root);
}

/**
 * The part of a diagram of `dimensions` grid units visible in a viewport,
 * given the bounding rectangles of the viewport and of the diagram on
 * screen.
 */
export function visibleBox(
  viewport: DOMRect,
  diagram: DOMRect,
  gridSize: number,
  [width, height]: [number, number],
): ViewBox {
  const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));
  const x0 = clamp((viewport.left - diagram.left) / gridSize, width);
  const y0 = clamp((viewport.top - diagram.top) / gridSize, height);
  const x1 = clamp((viewport.right - diagram.left) / gridSize, width);
  const y1 = clamp((viewport.bottom - diagram.top) / gridSize, height);
  return [x0, y0, x1 - x0, y1 - y0];
}

/** Largest image side in pixels; larger exports are scaled down to fit. */
export const maxPngSize = 8192;

/**
 * Draws an SVG document onto a canvas of `width` × `height` CSS pixels
 * times `pixelRatio`, scaled down if a side would exceed `maxPngSize`.
 */
async function renderCanvas(
  svgText: string,
  width: number,
  height: number,
  pixelRatio: number,
): Promise<HTMLCanvasElement> {
  const ratio = Math.min(
    pixelRatio,
    maxPngSize / Math.max(1, width),
    maxPngSize / Math.max(1, height),
  );
  const url = URL.createObjectURL(
    new Blob([svgText], { type: 'image/svg+xml' }),
  );
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    canvas
      .getContext('2d')!
      .drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Renders an SVG document to a PNG of at most `maxPngSize` per side. */
export async function svgToPng(
  svgText: string,
  width: number,
  height: number,
  pixelRatio = 2,
): Promise<Blob> {
  const canvas = await renderCanvas(svgText, width, height, pixelRatio);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      blob =>
        blob ? resolve(blob) : reject(new Error('PNG could not be created')),
      'image/png',
    );
  });
}

/** Points per CSS pixel (72 / 96). */
const pointsPerPixel = 0.75;

/** Compresses bytes in the zlib format PDF's `FlateDecode` expects. */
/** Bytes backed by a plain `ArrayBuffer`, as `Blob` accepts. */
type Bytes = Uint8Array<ArrayBuffer>;

async function deflate(bytes: Bytes): Promise<Bytes> {
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Writes a one page PDF showing an RGB image (`rgb`, `columns` × `rows`
 * pixels, losslessly compressed) over a page of `width` × `height` points.
 * No library is needed: the file is a catalog, a page tree, one page, the
 * image and the content stream drawing it.
 */
export async function imagePdf(
  rgb: Bytes,
  columns: number,
  rows: number,
  width: number,
  height: number,
): Promise<Blob> {
  const encoder = new TextEncoder();
  const image = await deflate(rgb);
  const w = Number(width.toFixed(2));
  const h = Number(height.toFixed(2));
  const content = encoder.encode(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`);
  const objects: (string | Bytes)[][] = [
    ['<< /Type /Catalog /Pages 2 0 R >>'],
    ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
    ],
    [
      `<< /Type /XObject /Subtype /Image /Width ${columns} /Height ${rows} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.length} >>\nstream\n`,
      image,
      '\nendstream',
    ],
    [`<< /Length ${content.length} >>\nstream\n`, content, '\nendstream'],
  ];

  const parts: Bytes[] = [];
  let offset = 0;
  const write = (part: string | Bytes) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    parts.push(bytes);
    offset += bytes.length;
  };
  write('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');
  const offsets = objects.map((object, k) => {
    const start = offset;
    write(`${k + 1} 0 obj\n`);
    object.forEach(write);
    write('\nendobj\n');
    return start;
  });
  const xref = offset;
  write(
    [
      'xref',
      `0 ${objects.length + 1}`,
      '0000000000 65535 f ',
      ...offsets.map(start => `${String(start).padStart(10, '0')} 00000 n `),
      'trailer',
      `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
      'startxref',
      `${xref}`,
      '%%EOF',
      '',
    ].join('\n'),
  );
  return new Blob(parts, { type: 'application/pdf' });
}

/**
 * Converts an SVG document to a one page PDF the size of the drawing
 * (`width` × `height` CSS pixels). The drawing is embedded as a lossless
 * image at three times screen resolution (about 290 dpi at actual size),
 * so the PDF needs no fonts or external libraries.
 */
export async function svgToPdf(
  svgText: string,
  width: number,
  height: number,
  pixelRatio = 3,
): Promise<Blob> {
  const canvas = await renderCanvas(svgText, width, height, pixelRatio);
  const { data } = canvas
    .getContext('2d')!
    .getImageData(0, 0, canvas.width, canvas.height);
  const rgb = new Uint8Array(canvas.width * canvas.height * 3);
  for (let source = 0, target = 0; source < data.length; source += 4) {
    rgb[target++] = data[source];
    rgb[target++] = data[source + 1];
    rgb[target++] = data[source + 2];
  }
  return imagePdf(
    rgb,
    canvas.width,
    canvas.height,
    Math.max(1, width * pointsPerPixel),
    Math.max(1, height * pointsPerPixel),
  );
}

/** A file name for an export, from the document and substation names. */
export function exportFileName(
  docName: string | undefined,
  substation: string,
  scope: ExportScope,
  format: ExportFormat,
): string {
  const base = (docName ?? '').replace(/\.[^.]*$/, '') || 'communication';
  const parts = [base, substation, 'communication'];
  if (scope === 'view') {
    parts.push('view');
  }
  return `${parts
    .filter(Boolean)
    .join('-')
    .replace(/[^\w.-]+/g, '_')}.${format}`;
}

/** Offers a file to the user to save. */
export function saveFile(blob: Blob, name: string): void {
  const link = document.createElement('a');
  link.download = name;
  link.href = URL.createObjectURL(blob);
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}
