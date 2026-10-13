import { expect } from '@open-wc/testing';

import { densify, edgeKey, orderRoutes } from './ordering.js';
import type { Point } from './routing.js';

describe('ordering', () => {
  it('densifies routes to lattice points', () => {
    expect(
      densify([
        [0, 0],
        [1, 0],
        [1, 0.75],
        [0.25, 0.75],
      ]),
    ).to.deep.equal([
      [0, 0],
      [0.5, 0],
      [1, 0],
      [1, 0.5],
      [1, 0.75],
      [0.5, 0.75],
      [0.25, 0.75],
    ]);
  });

  it('keys edges independently of direction', () => {
    expect(edgeKey([1, 0], [0.5, 0])).to.equal(edgeKey([0.5, 0], [1, 0]));
  });

  it('keeps routes joining and leaving on the same side apart', () => {
    // Both run along y = 2 from x = 1 to x = 4. `low` joins from below and
    // leaves downwards, `high` joins from above and leaves upwards.
    const low: Point[] = [
      [1, 4],
      [1, 2],
      [4, 2],
      [4, 4],
    ];
    const high: Point[] = [
      [0, 0],
      [0, 2],
      [5, 2],
      [5, 0],
    ];
    const order = orderRoutes([low, high]);
    const edge = edgeKey([2, 2], [2.5, 2]);
    expect(order.compare(0, 1, edge)).to.equal(1);
    expect(order.compare(1, 0, edge)).to.equal(-1);
    expect(order.compare(0, 1, edgeKey([9, 9], [9.5, 9]))).to.equal(0);
  });

  it('keeps the order around shared bends', () => {
    // Both turn from east to south at (4, 2); `outer` comes from further
    // left above and leaves further right.
    const inner: Point[] = [
      [2, 3],
      [2, 2],
      [4, 2],
      [4, 5],
      [3, 5],
    ];
    const outer: Point[] = [
      [1, 1],
      [1, 2],
      [4, 2],
      [4, 5],
      [6, 5],
    ];
    const order = orderRoutes([inner, outer]);
    // Horizontal part: inner joins from below (larger y).
    expect(order.compare(0, 1, edgeKey([3, 2], [3.5, 2]))).to.equal(1);
    // Vertical part: inner leaves to the left (smaller x).
    expect(order.compare(0, 1, edgeKey([4, 3], [4, 3.5]))).to.equal(-1);
  });

  it('orders routes travelling in opposite directions', () => {
    const east: Point[] = [
      [0, 1],
      [0, 2],
      [4, 2],
      [4, 3],
    ];
    const west: Point[] = [
      [5, 1],
      [5, 2],
      [1, 2],
      [1, 3],
    ];
    const order = orderRoutes([east, west]);
    const edge = edgeKey([2, 2], [2.5, 2]);
    // West joins from above at x = 5 but leaves below at x = 1, east the
    // other way round: one crossing is unavoidable; both agree on the order.
    expect(order.compare(0, 1, edge)).to.equal(-order.compare(1, 0, edge));
    expect(Math.abs(order.compare(0, 1, edge))).to.equal(1);
  });

  it('breaks ties between identical routes consistently', () => {
    const route: Point[] = [
      [0, 0],
      [3, 0],
    ];
    const order = orderRoutes([route, route.slice()]);
    const edge = edgeKey([1, 0], [1.5, 0]);
    expect(order.compare(0, 1, edge)).to.equal(-order.compare(1, 0, edge));
  });
});
