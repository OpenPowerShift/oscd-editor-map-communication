/**
 * Routes the connections drawn between IEDs on the single line diagram.
 *
 * The aim is a diagram where every connection can be followed and picked:
 * lines avoid IEDs, equipment, labels and busbars, cross each other as
 * little as possible, and lines sharing a path run side by side in lanes
 * instead of on top of each other. The approach follows orthogonal
 * connector routing (Wybrow, Marriott and Stuckey, *Orthogonal connector
 * routing*, 2009, as used by libavoid) in three stages:
 *
 * 1. **Search** (`grid-router.ts`): every connection gets a path on a
 *    half-cell lattice with A*, preferring the middle of the channels
 *    between symbols. Paths may share streets; crossing other lines is
 *    expensive. A second pass reroutes every connection knowing where all
 *    the others go.
 * 2. **Order** (`ordering.ts`): where paths share a stretch, which one runs
 *    on which side is decided from where they join and leave it, so lines
 *    running together do not cross needlessly, also around bends.
 * 3. **Nudge** (`nudge.ts`): shared stretches are spread into parallel lanes
 *    in that order, across the free room of their channel.
 *
 * The result is drawn with rounded corners and an arrowhead at the target
 * (`routing.ts`). `docs/routing.md` explains the choices and how they were
 * measured.
 *
 * Searching takes about a tenth of a second for fifty connections, so the
 * plugin draws `quickRoute` at once and replaces it with the result of
 * `routeConnectionsAsync`, which yields to the browser between searches.
 */
import { gridRouteSteps, type GridOptions, type GridRoute } from './grid-router.js';
import { nudgeRoutes } from './nudge.js';
import { orderRoutes } from './ordering.js';
import {
  drawRoute,
  faceDirections,
  facePoint,
  routePoints,
  type Obstacle,
  type Point,
  type RoutedConnection,
  type RouteInput,
} from './routing.js';

/** The diagram connections are routed on. */
export interface RoutingContext {
  /** Diagram size in grid cells. */
  dimensions: Point;
  /** IEDs, equipment, labels, wires and container borders. */
  obstacles: Obstacle[];
}

/**
 * Search settings. Measured on real substation files (see
 * `docs/routing.md`): turns and crossings are expensive, lines keep off
 * symbol outlines, labels, busbars and bay borders, and the second pass
 * searches exactly.
 */
export const routingSettings: GridOptions = {
  costs: {
    bend: 1.2,
    interior: 0,
    hug: 0.35,
    crossing: 1.5,
    congestion: 0.4,
    capacity: 6,
    narrowCapacity: 1,
    label: 2.5,
    wire: 2,
    border: 0.6,
  },
  strictBorders: true,
  passes: 2,
  window: 4,
  weight: 1.2,
  refineWeight: 1,
  budget: 10000,
};

/** Connections above which the search is cheaper: one pass, less budget. */
export const largeRouting = 150;

/** Search settings for a number of connections. */
export function settingsFor(connections: number): GridOptions {
  return connections > largeRouting
    ? { ...routingSettings, passes: 1, budget: 3000 }
    : routingSettings;
}

/** Symbol rectangles, which lanes must keep clear of. */
function symbolRects(obstacles: Obstacle[]) {
  return obstacles
    .filter(obstacle => (obstacle.kind ?? 'symbol') === 'symbol')
    .map(obstacle => obstacle.rect);
}

/** Stages 2 and 3: orders and nudges searched paths, then draws them. */
function lanes(routes: GridRoute[], obstacles: Obstacle[]): RoutedConnection[] {
  const order = orderRoutes(routes.map(route => route.points));
  const points = nudgeRoutes(
    routes.map(route => ({ points: route.points, bundle: route.id })),
    {
      spacing: 0.16,
      maxWidth: 0.8,
      order,
      neighbours: true,
      obstacles: symbolRects(obstacles),
    },
  );
  return routes.map((route, k) => drawRoute(route.id, points[k]));
}

/** Routes connections; see the module description. */
export function routeConnections(
  inputs: RouteInput[],
  context: RoutingContext,
  settings: GridOptions = settingsFor(inputs.length),
): RoutedConnection[] {
  const steps = gridRouteSteps(
    inputs,
    context.dimensions,
    context.obstacles,
    settings,
  );
  let step = steps.next();
  while (!step.done) {
    step = steps.next();
  }
  return lanes(step.value, context.obstacles);
}

export interface AsyncRoutingOptions {
  /** Work done before yielding to the browser (ms). */
  slice?: number;
  /** Stops routing; the promise then resolves to `undefined`. */
  signal?: AbortSignal;
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * `routeConnections` in time slices: yields to the browser every `slice`
 * milliseconds between searches, so the page stays responsive.
 */
export async function routeConnectionsAsync(
  inputs: RouteInput[],
  context: RoutingContext,
  { slice = 12, signal }: AsyncRoutingOptions = {},
): Promise<RoutedConnection[] | undefined> {
  const steps = gridRouteSteps(
    inputs,
    context.dimensions,
    context.obstacles,
    settingsFor(inputs.length),
  );
  let started = performance.now();
  let step = steps.next();
  while (!step.done) {
    if (performance.now() - started >= slice) {
      await nextTask();
      if (signal?.aborted) {
        return undefined;
      }
      started = performance.now();
    }
    step = steps.next();
  }
  return signal?.aborted ? undefined : lanes(step.value, context.obstacles);
}

/**
 * A preview drawn while the connections are searched, in a few
 * milliseconds: fixed Z and L shapes between faces chosen from the IEDs'
 * relative positions (`faceDirections`), attachments spread along each face
 * in the order of where they head, and overlapping lines nudged apart. It
 * does not avoid symbols or labels.
 */
export function quickRoute(
  inputs: RouteInput[],
  context: RoutingContext,
): RoutedConnection[] {
  const faces = inputs.map(({ source, target }) =>
    faceDirections(source.position, target.position),
  );
  // Order the attachments on each face by the other end's position along
  // the face, so lines leaving one face do not cross right away.
  const attachments = new Map<
    string,
    { k: number; end: 'source' | 'target'; along: number }[]
  >();
  inputs.forEach(({ source, target }, k) => {
    for (const end of ['source', 'target'] as const) {
      const [self, other] = end === 'source' ? [source, target] : [target, source];
      const face = faces[k][end];
      const axis = face === 'n' || face === 's' ? 0 : 1;
      const key = `${self.key}|${face}`;
      if (!attachments.has(key)) {
        attachments.set(key, []);
      }
      attachments.get(key)!.push({
        k,
        end,
        along: other.position[axis] + (end === 'target' ? 0.001 : 0),
      });
    }
  });
  const offsets = inputs.map(() => ({ source: 0.5, target: 0.5 }));
  attachments.forEach((list) => {
    list
      .sort((a, b) => a.along - b.along || a.k - b.k)
      .forEach(({ k, end }, i) => {
        offsets[k][end] = (2 * i + 1) / (2 * list.length);
      });
  });
  const shapes = inputs.map(({ source, target }, k) =>
    routePoints(
      facePoint(source.position, faces[k].source, offsets[k].source),
      facePoint(target.position, faces[k].target, offsets[k].target),
      faces[k],
    ),
  );
  const points = nudgeRoutes(
    shapes.map((route, k) => ({ points: route, bundle: inputs[k].id })),
    { spacing: 0.12, obstacles: symbolRects(context.obstacles) },
  );
  return inputs.map(({ id }, k) => drawRoute(id, points[k]));
}
