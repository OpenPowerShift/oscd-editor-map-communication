import { expect } from '@open-wc/testing';

import { nudgeRoutes } from './nudge.js';
import { orderRoutes } from './ordering.js';
import type { Point } from './routing.js';

describe('nudgeRoutes', () => {
  it('separates overlapping collinear segments of different bundles', () => {
    const [a, b] = nudgeRoutes([
      {
        bundle: 'a',
        points: [
          [0, 0],
          [0, 2],
          [4, 2],
          [4, 3],
        ],
      },
      {
        bundle: 'b',
        points: [
          [1, 0],
          [1, 2],
          [5, 2],
          [5, 3],
        ],
      },
    ]);
    expect(a[1][1]).to.not.equal(b[1][1]);
    expect(Math.abs(a[1][1] - b[1][1])).to.be.closeTo(0.14, 1e-9);
    // Corners follow their shifted segments.
    expect(a[2][1]).to.equal(a[1][1]);
    expect(a[0]).to.deep.equal([0, 0]);
  });

  it('keeps routes of one bundle on one lane', () => {
    const [a, b] = nudgeRoutes([
      {
        bundle: 'x',
        points: [
          [0, 1],
          [4, 1],
        ],
      },
      {
        bundle: 'x',
        points: [
          [2, 1],
          [6, 1],
        ],
      },
    ]);
    expect([a[0][1], b[0][1]]).to.deep.equal([1, 1]);
  });

  it('leaves separate and single segments alone', () => {
    const routes = nudgeRoutes([
      {
        bundle: 'a',
        points: [
          [0, 1],
          [1, 1],
        ],
      },
      {
        bundle: 'b',
        points: [
          [2, 1],
          [3, 1],
        ],
      },
      { bundle: 'c', points: [[9, 9]] },
    ]);
    expect(routes).to.deep.equal([
      [
        [0, 1],
        [1, 1],
      ],
      [
        [2, 1],
        [3, 1],
      ],
      [[9, 9]],
    ]);
  });

  it('shifts lanes away from neighbouring symbols', () => {
    const [a, b] = nudgeRoutes(
      [
        {
          bundle: 'a',
          points: [
            [0, 1],
            [4, 1],
          ],
        },
        {
          bundle: 'b',
          points: [
            [0, 1],
            [4, 1],
          ],
        },
      ],
      { obstacles: [[1, 1, 1, 1]] },
    );
    // A symbol right below the line: both lanes move above it.
    expect(Math.max(a[0][1], b[0][1])).to.be.at.most(1 - 0.1 + 1e-9);
  });

  it('keeps a minimum spacing where symbols leave no room', () => {
    const [a, b] = nudgeRoutes(
      [
        {
          bundle: 'a',
          points: [
            [0, 1],
            [4, 1],
          ],
        },
        {
          bundle: 'b',
          points: [
            [0, 1],
            [4, 1],
          ],
        },
      ],
      {
        obstacles: [
          [1, 1, 1, 1],
          [1, 0, 1, 1],
        ],
      },
    );
    expect(Math.abs(a[0][1] - b[0][1])).to.be.closeTo(0.08, 1e-9);
  });

  it('assigns lanes in route order, avoiding needless crossings', () => {
    // `low` joins from below and leaves downwards, `high` from above and
    // upwards; first come, first served would put `low` above.
    const low: Point[] = [
      [0, 4],
      [0, 2],
      [5, 2],
      [5, 4],
    ];
    const high: Point[] = [
      [1, 0],
      [1, 2],
      [4, 2],
      [4, 0],
    ];
    const routes = [
      { bundle: 'low', points: low },
      { bundle: 'high', points: high },
    ];
    const [plainLow, plainHigh] = nudgeRoutes(routes);
    expect(plainLow[1][1]).to.be.lessThan(plainHigh[1][1]);
    const [orderedLow, orderedHigh] = nudgeRoutes(routes, {
      order: orderRoutes([low, high]),
    });
    expect(orderedLow[1][1]).to.be.greaterThan(orderedHigh[1][1]);
  });

  it('gives overlapping clusters distinct lanes even without an order', () => {
    const routes = ['a', 'b', 'c'].map(bundle => ({
      bundle,
      points: [
        [0, 1],
        [4, 1],
      ] as Point[],
    }));
    const ys = nudgeRoutes(routes, { order: orderRoutes([]) }).map(
      points => points[0][1],
    );
    expect(new Set(ys).size).to.equal(3);
  });

  it('shares the room with lanes on neighbouring lines', () => {
    const lane = (bundle: string, y: number) => ({
      bundle,
      points: [
        [0, y],
        [4, y],
      ] as Point[],
    });
    const routes = [lane('a', 1), lane('b', 1), lane('c', 1), lane('d', 1.5)];
    const spread = nudgeRoutes(routes, { spacing: 0.2, maxWidth: 1 });
    const shared = nudgeRoutes(routes, {
      spacing: 0.2,
      maxWidth: 1,
      neighbours: true,
    });
    const top = (result: Point[][]) =>
      Math.max(...result.slice(0, 3).map(points => points[0][1]));
    expect(top(spread)).to.be.closeTo(1.2, 1e-9);
    expect(top(shared)).to.be.at.most(1.25 - 0.1 + 1e-9);
  });
});
