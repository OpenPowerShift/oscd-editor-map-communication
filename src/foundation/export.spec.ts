import { expect } from '@open-wc/testing';

import {
  composeSvg,
  exportFileName,
  imagePdf,
  inlineStyles,
  maxPngSize,
  saveFile,
  svgToPdf,
  svgToPng,
  visibleBox,
} from './export.js';

/** An SVG in a shadow root, styled by the shadow root's stylesheet. */
function shadowSvg(markup: string, css: string): {
  host: HTMLElement;
  svg: SVGSVGElement;
} {
  const host = document.createElement('div');
  document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${css}</style>${markup}`;
  return { host, svg: root.querySelector('svg')! };
}

describe('export', () => {
  it('inlines computed styles and drops interaction-only parts', () => {
    const { host, svg } = shadowSvg(
      `<svg viewBox="0 0 4 4"><g class="line" style="--c: rgb(1, 2, 3)"><path class="stroke" d="M0,0L4,0"/><path class="hit" d="M0,0L4,0"/><title>tip</title><rect class="gone" width="1" height="1"/></g></svg>`,
      `.stroke { stroke: var(--c); stroke-width: 0.1px; } .gone { display: none; }`,
    );
    const clone = svg.cloneNode(true) as SVGSVGElement;
    inlineStyles(svg, clone);
    const path = clone.querySelector('path')!;
    expect(path.getAttribute('style')).to.contain('stroke: rgb(1, 2, 3)');
    expect(path.hasAttribute('class')).to.equal(false);
    expect(clone.querySelectorAll('path')).to.have.length(1);
    expect(clone.querySelector('title') === null).to.equal(true);
    expect(clone.querySelector('rect') === null).to.equal(true);
    host.remove();
  });

  it('composes layers into one cropped, standalone SVG', () => {
    const { host, svg } = shadowSvg(
      '<svg viewBox="0 0 10 5"><circle cx="1" cy="1" r="1" class="dot"/></svg>',
      '.dot { fill: rgb(0, 128, 0); }',
    );
    const text = composeSvg([svg, svg], [2, 1, 4, 3], 10, 'rgb(255, 255, 255)');
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = doc.documentElement;
    expect(root.getAttribute('viewBox')).to.equal('2 1 4 3');
    expect(root.getAttribute('width')).to.equal('40');
    expect(root.getAttribute('height')).to.equal('30');
    expect(root.querySelector('rect')!.getAttribute('fill')).to.equal(
      'rgb(255, 255, 255)',
    );
    expect(root.querySelectorAll('g > circle')).to.have.length(2);
    expect(root.querySelector('circle')!.getAttribute('style')).to.contain(
      'fill: rgb(0, 128, 0)',
    );
    host.remove();
  });

  it('finds the visible part of the diagram', () => {
    const viewport = new DOMRect(0, 0, 400, 300);
    expect(
      visibleBox(viewport, new DOMRect(-100, -60, 2000, 1000), 20, [100, 50]),
    ).to.deep.equal([5, 3, 20, 15]);
    // Diagram smaller than the viewport: all of it.
    expect(
      visibleBox(viewport, new DOMRect(50, 50, 200, 100), 20, [10, 5]),
    ).to.deep.equal([0, 0, 10, 5]);
  });

  it('renders SVG to a PNG, limiting its size', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="5"><rect width="10" height="5" fill="red"/></svg>';
    const png = await svgToPng(svg, 10, 5);
    expect(png.type).to.equal('image/png');
    const image = await createImageBitmap(png);
    expect([image.width, image.height]).to.deep.equal([20, 10]);

    const large = await svgToPng(svg, maxPngSize * 2, 5, 1);
    const scaled = await createImageBitmap(large);
    expect(scaled.width).to.equal(maxPngSize);
  });

  it('writes a valid one page PDF around an image', async () => {
    // Two red pixels on a 30 x 15 point page.
    const pdf = await imagePdf(
      new Uint8Array([255, 0, 0, 255, 0, 0]),
      2,
      1,
      30,
      15,
    );
    expect(pdf.type).to.equal('application/pdf');
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-1.4')).to.equal(true);
    expect(text.trimEnd().endsWith('%%EOF')).to.equal(true);
    expect(text).to.contain('/MediaBox [0 0 30 15]');
    expect(text).to.contain('/Width 2 /Height 1');
    // Every cross-reference entry points at its object.
    const xref = Number(text.match(/startxref\n(\d+)/)![1]);
    expect(text.slice(xref, xref + 4)).to.equal('xref');
    const offsets = Array.from(
      text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm),
      match => Number(match[1]),
    );
    expect(offsets.map((offset, k) => text.slice(offset).startsWith(`${k + 1} 0 obj`)))
      .to.deep.equal([true, true, true, true, true]);
    // The image data inflates back to the pixels.
    const start = text.indexOf('stream\n') + 'stream\n'.length;
    const length = Number(text.match(/\/Image .*?\/Length (\d+)/)![1]);
    const inflated = await new Response(
      new Blob([bytes.slice(start, start + length)])
        .stream()
        .pipeThrough(new DecompressionStream('deflate')),
    ).arrayBuffer();
    expect(Array.from(new Uint8Array(inflated))).to.deep.equal([
      255, 0, 0, 255, 0, 0,
    ]);
  });

  it('converts SVG to a PDF the size of the drawing', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="blue"/></svg>';
    const text = await (await svgToPdf(svg, 40, 20, 1)).text();
    expect(text).to.contain('/MediaBox [0 0 30 15]');
    expect(text).to.contain('/Width 40 /Height 20');
  });

  it('names export files', () => {
    expect(exportFileName('My File.scd', 'S1', 'diagram', 'svg')).to.equal(
      'My_File-S1-communication.svg',
    );
    expect(exportFileName(undefined, 'S 2', 'view', 'png')).to.equal(
      'communication-S_2-communication-view.png',
    );
  });

  it('offers files for download', () => {
    const clicked: string[] = [];
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function record(this: HTMLAnchorElement) {
      clicked.push(this.download);
    };
    try {
      saveFile(new Blob(['x']), 'a.svg');
    } finally {
      HTMLAnchorElement.prototype.click = click;
    }
    expect(clicked).to.deep.equal(['a.svg']);
    expect(document.querySelector('a[download]') === null).to.equal(true);
  });
});
