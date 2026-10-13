import { expect } from '@open-wc/testing';

import { measureRoutes, type MeasuredRoute } from './routing-metrics.js';

function route(
  id: string,
  points: [number, number][],
  bundle = id,
  ends: [string, string] = ['A', 'B'],
): MeasuredRoute {
  return { id, bundle, points, ends };
}

describe('routing-metrics', () => {
  it('measures length, bends and ink', () => {
    const metrics = measureRoutes([
      route('a', [
        [0, 0],
        [0, 2],
        [3, 2],
      ]),
      route('b', [
        [5, 2],
        [1, 2],
      ], 'a'),
    ]);
    expect(metrics).to.include({ routes: 2, length: 9, bends: 1, ink: 7 });
  });

  it('counts crossings and crossing pairs of different bundles', () => {
    const metrics = measureRoutes([
      route('h1', [
        [0, 1],
        [4, 1],
      ]),
      route('h2', [
        [0, 2],
        [4, 2],
      ]),
      route('v', [
        [2, 0],
        [2, 3],
      ]),
      route('same', [
        [3, 0],
        [3, 3],
      ], 'h1'),
    ]);
    expect(metrics.crossings).to.equal(3);
    expect(metrics.crossingPairs).to.equal(3);
  });

  it('separates ambiguous overlap from crowded parallel lines', () => {
    const metrics = measureRoutes([
      route('a', [
        [0, 1],
        [4, 1],
      ]),
      route('b', [
        [2, 1],
        [6, 1],
      ]),
      route('c', [
        [0, 1.05],
        [1, 1.05],
      ]),
      route('d', [
        [0, 0],
        [0, 4],
      ]),
      route('e', [
        [0.01, 1],
        [0.01, 3],
      ]),
    ]);
    // a/b overlap on y = 1, d/e on x = 0; c runs 0.05 from a.
    expect(metrics.overlap).to.equal(2 + 2);
    expect(metrics.crowded).to.equal(1);
  });

  it('measures intrusion into symbols, labels and along wires', () => {
    const metrics = measureRoutes(
      [
        route('a', [
          [0, 1.5],
          [6, 1.5],
        ]),
      ],
      [
        { ied: 'A', rect: [0, 1, 1, 1] },
        { ied: 'X', rect: [2, 1, 1, 1] },
        { rect: [4, 1, 1, 1] },
        { kind: 'label', rect: [5, 1, 0.5, 1] },
        { kind: 'wire', rect: [3, 1.5, 2, 0] },
        { kind: 'wire', rect: [3, 0, 0, 3] },
      ],
    );
    expect(metrics.intrusion).to.equal(1.8);
    expect(metrics.labelIntrusion).to.equal(0.4);
    expect(metrics.wireOverlap).to.equal(2);
  });
});
