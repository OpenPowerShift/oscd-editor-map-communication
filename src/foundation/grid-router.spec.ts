import { expect } from '@open-wc/testing';

import { gridRoute } from './grid-router.js';
import { densify } from './ordering.js';
import { measureRoutes } from '../testing/routing-metrics.js';
import { entryFace, type Obstacle, type RouteInput } from './routing.js';

function input(
  id: string,
  source: [number, number],
  target: [number, number],
): RouteInput {
  return {
    id,
    source: { key: `S${source.join()}`, position: source },
    target: { key: `T${target.join()}`, position: target },
  };
}

function ieds(inputs: RouteInput[]): Obstacle[] {
  return inputs.flatMap(({ source, target }) => [
    { ied: source.key, rect: [...source.position, 1, 1] as Obstacle['rect'] },
    { ied: target.key, rect: [...target.position, 1, 1] as Obstacle['rect'] },
  ]);
}

describe('gridRoute', () => {
  it('routes between face midpoints, entering the target head on', () => {
    const inputs = [input('a', [1, 1], [6, 1])];
    const [route] = gridRoute(inputs, [10, 5], ieds(inputs));
    expect(route.found).to.equal(true);
    expect(route.points[0]).to.deep.equal([2, 1.5]);
    expect(route.points[route.points.length - 1]).to.deep.equal([6, 1.5]);
    expect(entryFace(route.points)).to.equal('w');
  });

  it('goes around symbols in the way', () => {
    const inputs = [input('a', [1, 2], [7, 2])];
    const obstacles: Obstacle[] = [
      ...ieds(inputs),
      { rect: [4, 1, 1, 3] },
    ];
    const [route] = gridRoute(inputs, [10, 6], obstacles);
    const metrics = measureRoutes(
      [{ id: 'a', bundle: 'a', points: route.points, ends: ['S1,2', 'T7,2'] }],
      obstacles,
    );
    expect(route.found).to.equal(true);
    expect(metrics.intrusion).to.equal(0);
  });

  it('avoids labels and primary wires when it can', () => {
    const inputs = [input('a', [1, 2], [7, 2])];
    const obstacles: Obstacle[] = [
      ...ieds(inputs),
      { kind: 'label', rect: [3, 1.6, 2, 0.8] },
      { kind: 'wire', rect: [3, 2.5, 3, 0] },
    ];
    const [route] = gridRoute(inputs, [10, 6], obstacles);
    const metrics = measureRoutes(
      [{ id: 'a', bundle: 'a', points: route.points, ends: ['S1,2', 'T7,2'] }],
      obstacles,
    );
    // A straight route would cross 2 units of label and run 3 along the wire.
    expect(metrics.labelIntrusion).to.be.lessThan(1);
    expect(metrics.wireOverlap).to.equal(0);
  });

  it('spreads routes over streets once a street is full', () => {
    const inputs = [
      input('a', [1, 1], [8, 1]),
      input('b', [1, 3], [8, 3]),
      input('c', [1, 5], [8, 5]),
    ];
    const routes = gridRoute(inputs, [10, 8], ieds(inputs), {
      costs: { capacity: 1, congestion: 5 },
    });
    expect(routes.every(route => route.found)).to.equal(true);
  });

  it('respects a search window, widening it when needed', () => {
    const inputs = [input('a', [1, 1], [3, 1])];
    const obstacles: Obstacle[] = [
      ...ieds(inputs),
      { rect: [2, 0, 1, 4] },
    ];
    const [route] = gridRoute(inputs, [6, 8], obstacles, { window: 0.5 });
    expect(route.found).to.equal(true);
  });

  it('ignores other lines when out of budget, falls back when blocked', () => {
    const inputs = [input('a', [1, 1], [8, 6])];
    const [budgeted] = gridRoute(inputs, [10, 8], ieds(inputs), { budget: 3 });
    expect(budgeted.found).to.equal(true);

    const walled: Obstacle[] = [...ieds(inputs), { rect: [3, -1, 3, 10] }];
    const [blocked] = gridRoute(inputs, [10, 8], walled);
    expect(blocked.found).to.equal(false);
    expect(blocked.points[0]).to.deep.equal([1.5, 2]);
  });

  it('blocks borders between symbols with strict borders', () => {
    const inputs = [input('a', [0, 4], [6, 4])];
    const obstacles: Obstacle[] = [
      ...ieds(inputs),
      { rect: [3, -1, 1, 5] },
      { rect: [3, 4, 1, 5] },
    ];
    const [loose] = gridRoute(inputs, [10, 8], obstacles);
    const [strict] = gridRoute(inputs, [10, 8], obstacles, {
      strictBorders: true,
    });
    expect(loose.found).to.equal(true);
    expect(strict.found).to.equal(false);
  });

  it('keeps arrows off faces covered by labels', () => {
    const inputs = [input('a', [1, 2], [6, 2])];
    const obstacles: Obstacle[] = [
      ...ieds(inputs),
      // The target's name, right of it, and a label left of it.
      { kind: 'label', rect: [7.1, 2.2, 2, 0.6] },
      { kind: 'label', rect: [4.4, 2.2, 1.5, 0.6] },
    ];
    const [route] = gridRoute(inputs, [10, 6], obstacles);
    expect(entryFace(route.points)).to.not.equal('w');
    expect(entryFace(route.points)).to.not.equal('e');

    // With every face covered, any face is used.
    const covered: Obstacle[] = [
      ...ieds(inputs),
      { kind: 'label', rect: [5, 1, 3, 3] },
    ];
    expect(gridRoute(inputs, [10, 6], covered)[0].found).to.equal(true);
  });

  it('prefers channel centres and avoids container borders when asked', () => {
    // The only way up is a channel between x = 4 and x = 5.
    const inputs = [input('a', [1, 7], [7, 0])];
    const obstacles: Obstacle[] = [
      ...ieds(inputs),
      { rect: [0, 2, 4, 4] },
      { rect: [5, 2, 5, 4] },
    ];
    const inChannel = (route: { points: [number, number][] }) =>
      Array.from(
        new Set(
          densify(route.points)
            .filter(([, y]) => y > 2 && y < 6)
            .map(([x]) => x),
        ),
      );
    const [plain] = gridRoute(inputs, [10, 8], obstacles);
    const [centred] = gridRoute(inputs, [10, 8], obstacles, {
      costs: { hug: 1 },
    });
    const [bordered] = gridRoute(
      inputs,
      [10, 8],
      [...obstacles, { kind: 'border', rect: [4, 2, 1, 4] }],
      { costs: { border: 2 } },
    );
    expect(inChannel(plain)).to.satisfy(
      (xs: number[]) => xs.length === 1 && (xs[0] === 4 || xs[0] === 5),
    );
    expect(inChannel(centred)).to.deep.equal([4.5]);
    expect(inChannel(bordered)).to.deep.equal([4.5]);
  });

  it('reroutes in later passes knowing all other routes', () => {
    const inputs = [
      input('a', [1, 1], [8, 5]),
      input('b', [1, 5], [8, 1]),
      input('c', [1, 3], [8, 3]),
    ];
    const once = gridRoute(inputs, [10, 8], ieds(inputs), {
      costs: { crossing: 2 },
    });
    const twice = gridRoute(inputs, [10, 8], ieds(inputs), {
      costs: { crossing: 2 },
      passes: 2,
    });
    const crossings = (routes: { id: string; points: [number, number][] }[]) =>
      measureRoutes(
        routes.map(r => ({ id: r.id, bundle: r.id, points: r.points, ends: ['', ''] })),
      ).crossings;
    expect(twice.every(route => route.found)).to.equal(true);
    expect(crossings(twice)).to.be.at.most(crossings(once));
  });
});
