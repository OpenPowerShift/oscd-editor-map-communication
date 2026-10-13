import { expect } from '@open-wc/testing';

import {
  largeRouting,
  quickRoute,
  routeConnections,
  routeConnectionsAsync,
  routingSettings,
  settingsFor,
  type RoutingContext,
} from './connection-routing.js';
import { measureRoutes } from '../testing/routing-metrics.js';
import type { Point, RoutedConnection, RouteInput } from './routing.js';

function input(
  id: string,
  source: [string, number, number],
  target: [string, number, number],
): RouteInput {
  return {
    id,
    source: { key: source[0], position: [source[1], source[2]] },
    target: { key: target[0], position: [target[1], target[2]] },
  };
}

const inputs = [
  input('a', ['P', 2, 2], ['C', 8, 6]),
  input('b', ['P', 2, 2], ['D', 2, 8]),
  input('c', ['M', 6, 2], ['C', 8, 6]),
  input('d', ['C', 8, 6], ['P', 2, 2]),
  input('e', ['M', 6, 2], ['D', 2, 8]),
];

const ied = (name: string, x: number, y: number) => ({
  ied: name,
  rect: [x, y, 1, 1] as [number, number, number, number],
});

const context: RoutingContext = {
  dimensions: [12, 10],
  obstacles: [ied('P', 2, 2), ied('C', 8, 6), ied('D', 2, 8), ied('M', 6, 2)],
};

function isOrthogonal(points: Point[]): boolean {
  return points.every((point, i) => {
    if (i === 0) {
      return true;
    }
    const [x1, y1] = points[i - 1];
    const [x2, y2] = point;
    return Math.abs(x1 - x2) < 1e-6 || Math.abs(y1 - y2) < 1e-6;
  });
}

function measure(routed: RoutedConnection[]) {
  return measureRoutes(
    routed.map((route, k) => ({
      id: route.id,
      bundle: route.id,
      points: route.points,
      ends: [inputs[k].source.key, inputs[k].target.key],
    })),
    context.obstacles,
  );
}

describe('connection-routing', () => {
  it('routes every connection orthogonally, face to face', () => {
    const routed = routeConnections(inputs, context);
    expect(routed.map(route => route.id)).to.deep.equal(['a', 'b', 'c', 'd', 'e']);
    routed.forEach(({ points, path, arrow }) => {
      expect(isOrthogonal(points)).to.equal(true);
      expect(path.startsWith('M')).to.equal(true);
      expect(arrow).to.contain('Z');
    });
  });

  it('keeps lines apart, out of symbols and with few crossings', () => {
    const searched = measure(routeConnections(inputs, context));
    const quick = measure(quickRoute(inputs, context));
    expect(searched.overlap).to.equal(0);
    expect(searched.intrusion).to.equal(0);
    expect(searched.crossings).to.be.at.most(quick.crossings);
  });

  it('draws a quick preview with lines nudged apart', () => {
    const routed = quickRoute(inputs, context);
    expect(routed).to.have.length(5);
    routed.forEach(({ points }) => expect(isOrthogonal(points)).to.equal(true));
    expect(measure(routed).overlap).to.equal(0);
  });

  it('spreads preview lines on a face in the order they head', () => {
    const [right, left] = quickRoute(
      [input('right', ['S', 5, 5], ['R', 9, 1]), input('left', ['S', 5, 5], ['L', 1, 1])],
      { dimensions: [12, 8], obstacles: [] },
    );
    // Both leave the north face; the one heading left attaches further left.
    expect(left.points[0][0]).to.be.lessThan(right.points[0][0]);
  });

  it('routes in time slices with the same result', async () => {
    const sliced = await routeConnectionsAsync(inputs, context, { slice: 0 });
    expect(sliced).to.deep.equal(routeConnections(inputs, context));
  });

  it('stops routing in time slices when aborted', async () => {
    const aborted = new AbortController();
    aborted.abort();
    expect(
      await routeConnectionsAsync(inputs, context, {
        slice: 0,
        signal: aborted.signal,
      }),
    ).to.equal(undefined);

    const late = new AbortController();
    const routing = routeConnectionsAsync(inputs, context, {
      slice: 0,
      signal: late.signal,
    });
    late.abort();
    expect(await routing).to.equal(undefined);
  });

  it('searches less thoroughly on large diagrams', () => {
    expect(settingsFor(10)).to.equal(routingSettings);
    expect(settingsFor(largeRouting + 1)).to.include({ passes: 1 });
  });
});
