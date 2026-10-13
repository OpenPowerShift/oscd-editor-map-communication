import { expect } from '@open-wc/testing';

import {
  arrowPath,
  drawRoute,
  entryFace,
  faceDirections,
  facePoint,
  roundedPath,
  routePoints,
  simplify,
} from './routing.js';

describe('routing', () => {
  it('simplifies repeated and collinear points', () => {
    expect(
      simplify([
        [0, 0],
        [0, 0],
        [0, 1],
        [0, 2],
        [1, 2],
        [2, 2],
      ]),
    ).to.deep.equal([
      [0, 0],
      [0, 2],
      [2, 2],
    ]);
  });

  describe('faceDirections', () => {
    const table: [[number, number], string][] = [
      [[3, 0], 'n n'],
      [[0, 1], 'w w'],
      [[0, -1], 'w w'],
      [[-2, 1], 'n w'],
      [[2, 1], 'n e'],
      [[-2, -1], 's w'],
      [[2, -1], 's e'],
      [[0, 4], 'n s'],
      [[5, -4], 's n'],
      [[0, 0], 's n'],
    ];
    table.forEach(([[dx, dy], expected]) => {
      it(`source offset (${dx}, ${dy}) uses faces ${expected}`, () => {
        const { source, target } = faceDirections([10 + dx, 10 + dy], [10, 10]);
        expect(`${source} ${target}`).to.equal(expected);
      });
    });
  });

  it('places attachment points on each face', () => {
    expect(facePoint([2, 3], 'n', 0.25)).to.deep.equal([2.25, 3]);
    expect(facePoint([2, 3], 's', 0.25)).to.deep.equal([2.25, 4]);
    expect(facePoint([2, 3], 'w', 0.25)).to.deep.equal([2, 3.25]);
    expect(facePoint([2, 3], 'e', 0.25)).to.deep.equal([3, 3.25]);
  });

  it('draws straight lines without corners', () => {
    expect(roundedPath([[1, 1], [1, 4]])).to.equal('M1,1L1,4');
  });

  it('limits corner radii to the available segment length', () => {
    const path = roundedPath([
      [0, 0],
      [0, -1],
      [0.1, -1],
      [0.1, 0],
    ]);
    expect(path).to.equal(
      'M0,0L0,-0.95A0.05,0.05 0 0 1 0.05,-1L0.05,-1A0.05,0.05 0 0 1 0.1,-0.95L0.1,0',
    );
  });

  it('draws arrowheads pointing into the target face', () => {
    expect(arrowPath([1, 1], 'e')).to.equal('M1,1L1.16,1.08L1.16,0.92Z');
    expect(arrowPath([1, 1], 'w')).to.equal('M1,1L0.84,1.08L0.84,0.92Z');
  });

  it('routes adjacent rows with a single corner', () => {
    expect(
      routePoints([2.5, 5], [4, 4.5], { source: 'n', target: 'w' }),
    ).to.deep.equal([
      [2.5, 5],
      [2.5, 4.5],
      [4, 4.5],
    ]);
  });

  it('draws a route with an arrowhead entering its last face', () => {
    const points: [number, number][] = [
      [1, 1],
      [1, 3],
      [4, 3],
    ];
    expect(entryFace(points)).to.equal('w');
    expect(entryFace(points.slice(0, 2))).to.equal('n');
    expect(entryFace([[2, 3], [2, 1]])).to.equal('s');
    expect(entryFace([[4, 3], [1, 3]])).to.equal('e');
    const route = drawRoute('a', points);
    expect(route.id).to.equal('a');
    expect(route.path).to.equal(roundedPath(points));
    expect(route.arrow).to.equal(arrowPath([4, 3], 'w'));
  });
});
