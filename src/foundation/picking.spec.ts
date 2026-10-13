import { expect } from '@open-wc/testing';

import { distanceToPolyline, pickRoutes } from './picking.js';

describe('picking', () => {
  it('measures the distance to a polyline', () => {
    const points: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 3],
    ];
    expect(distanceToPolyline([2, 1], points)).to.equal(1);
    expect(distanceToPolyline([5, 2], points)).to.equal(1);
    expect(distanceToPolyline([-3, -4], points)).to.equal(5);
    expect(distanceToPolyline([1, 1], [[1, 2]])).to.equal(1);
    expect(distanceToPolyline([1, 1], [])).to.equal(Infinity);
  });

  it('picks routes near a point, nearest first', () => {
    const routes = [
      {
        id: 'far',
        points: [
          [0, 1],
          [4, 1],
        ] as [number, number][],
      },
      {
        id: 'near',
        points: [
          [0, 1.1],
          [4, 1.1],
        ] as [number, number][],
      },
      {
        id: 'out',
        points: [
          [0, 3],
          [4, 3],
        ] as [number, number][],
      },
    ];
    expect(pickRoutes(routes, [2, 1.15], 0.2)).to.deep.equal(['near', 'far']);
    expect(pickRoutes(routes, [2, 2], 0.2)).to.deep.equal([]);
  });
});
