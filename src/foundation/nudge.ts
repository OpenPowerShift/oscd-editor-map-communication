/**
 * Stage 3 of connection routing: spreading lines that share a street into
 * parallel lanes (see `connection-routing.ts` and `docs/routing.md`).
 *
 * The searched paths run on lattice lines, so lines sharing a street are
 * drawn on top of each other until they are nudged apart here. Lanes are
 * positioned across the free room of their channel, in the order stage 2
 * decided, and every corner follows its two shifted segments.
 */
import { edgeKey, type RouteOrder } from './ordering.js';
import { simplify, type Point } from './routing.js';

export interface NudgeRoute {
  points: Point[];
  /**
   * Routes of one group share a lane where they run together. Connections
   * are routed as groups of one: their id.
   */
  bundle: string;
}

export interface NudgeOptions {
  /** Preferred distance between neighbouring lanes (grid units). */
  spacing?: number;
  /** Maximum total width of a set of lanes (grid units). */
  maxWidth?: number;
  /**
   * Symbol rectangles `[x, y, w, h]` lanes must stay clear of: a set of lanes
   * is fitted into the free room on either side of its line.
   */
  obstacles?: [number, number, number, number][];
  /** Clearance kept from obstacles (grid units). */
  clearance?: number;
  /**
   * Order of routes sharing paths (see `orderRoutes`). Lanes are then
   * assigned in that order, so routes running together do not cross;
   * without it lanes are assigned first come, first served.
   */
  order?: RouteOrder;
  /**
   * Also keep lanes clear of lanes on neighbouring parallel lines, sharing
   * the room between them. Lets lanes spread over a whole channel.
   */
  neighbours?: boolean;
}

interface Run {
  route: number;
  segment: number;
  from: number;
  to: number;
}

const eps = 1e-6;
/** Closest two lanes may be drawn. */
const minSpacing = 0.08;

/**
 * Separates collinear, overlapping segments of different groups into
 * parallel lanes, like the nudging step of orthogonal connector routers.
 *
 * Segments are grouped by orientation and coordinate (one lattice line).
 * On a line, overlapping runs of one group form a cluster, and overlapping
 * clusters get different lanes: in the given `order` (a longest path
 * through the "runs below" relation), or without one, the lowest free lane
 * (interval colouring). Each connected set of clusters is centred on the
 * original line, as far as the room between symbols (and, with
 * `neighbours`, lanes on nearby parallel lines) allows. Corners move to the
 * intersection of their shifted segments; end points slide along the IED
 * face.
 */
export function nudgeRoutes(
  routes: NudgeRoute[],
  {
    spacing = 0.14,
    maxWidth = 0.7,
    obstacles = [],
    clearance = 0.1,
    order,
    neighbours = false,
  }: NudgeOptions = {},
): Point[][] {
  const simplified = routes.map(route => simplify(route.points));
  const offsets = simplified.map(points =>
    new Array(Math.max(0, points.length - 1)).fill(0),
  );

  const groups = new Map<string, Run[]>();
  simplified.forEach((points, route) => {
    for (let segment = 1; segment < points.length; segment += 1) {
      const [x1, y1] = points[segment - 1];
      const [x2, y2] = points[segment];
      const horizontal = Math.abs(y1 - y2) < eps;
      const key = horizontal
        ? `h${y1.toFixed(3)}`
        : `v${x1.toFixed(3)}`;
      const run: Run = {
        route,
        segment: segment - 1,
        from: horizontal ? Math.min(x1, x2) : Math.min(y1, y2),
        to: horizontal ? Math.max(x1, x2) : Math.max(y1, y2),
      };
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(run);
    }
  });

  /** Free room below and above a line over an interval, capped at half the width. */
  const room = (
    horizontal: boolean,
    at: number,
    from: number,
    to: number,
  ): [number, number] => {
    let below = maxWidth / 2 + clearance;
    let above = maxWidth / 2 + clearance;
    obstacles.forEach(([x, y, w, h]) => {
      const [lo, hi, near, far] = horizontal ? [x, x + w, y, y + h] : [y, y + h, x, x + w];
      if (hi <= from + eps || lo >= to - eps) {
        return;
      }
      if (far <= at + eps) {
        below = Math.min(below, at - far);
      } else if (near >= at - eps) {
        above = Math.min(above, near - at);
      } else {
        // The line crosses the symbol: nothing to fit lanes against.
        below = maxWidth / 2 + clearance;
        above = maxWidth / 2 + clearance;
      }
    });
    // Negative room means the line itself is too close to a symbol.
    return [below - clearance, above - clearance];
  };

  /** Parallel lines with their extents, by orientation. */
  const lines = { h: [] as { at: number; from: number; to: number }[], v: [] as { at: number; from: number; to: number }[] };
  groups.forEach((runs, key) => {
    const at = Number(key.slice(1));
    runs.forEach(({ from, to }) =>
      lines[key[0] as 'h' | 'v'].push({ at, from, to }),
    );
  });

  /** Room up to the nearest neighbouring line, shared half and half. */
  const neighbourRoom = (
    horizontal: boolean,
    at: number,
    from: number,
    to: number,
  ): [number, number] => {
    let below = Infinity;
    let above = Infinity;
    lines[horizontal ? 'h' : 'v'].forEach((line) => {
      if (
        Math.abs(line.at - at) < eps ||
        Math.abs(line.at - at) > 1 + eps ||
        line.to <= from + eps ||
        line.from >= to - eps
      ) {
        return;
      }
      const half = Math.abs(line.at - at) / 2 - spacing / 2;
      if (line.at < at) {
        below = Math.min(below, half);
      } else {
        above = Math.min(above, half);
      }
    });
    return [below, above];
  };

  /** Order of two runs on a line: positive when `a` belongs at larger offsets. */
  const compareRuns = (a: Run, b: Run, horizontal: boolean, at: number): number => {
    if (!order) {
      return 0;
    }
    const from = Math.max(a.from, b.from);
    const to = Math.min(a.to, b.to);
    if (to - from < eps) {
      return 0;
    }
    const start = Math.floor(((from + to) / 2) * 2) / 2;
    const p: Point = horizontal ? [start, at] : [at, start];
    const q: Point = horizontal ? [start + 0.5, at] : [at, start + 0.5];
    return order.compare(a.route, b.route, edgeKey(p, q));
  };

  groups.forEach((runs, key) => {
    const horizontalGroup = key.startsWith('h');
    const at = Number(key.slice(1));
    // Cluster overlapping runs of the same bundle so they share one lane.
    const clusters: { bundle: string; from: number; to: number; runs: Run[] }[] = [];
    runs
      .sort((a, b) => a.from - b.from)
      .forEach((run) => {
        const bundle = routes[run.route].bundle;
        const cluster = clusters.find(
          c => c.bundle === bundle && run.from <= c.to + eps && run.to >= c.from - eps,
        );
        if (cluster) {
          cluster.from = Math.min(cluster.from, run.from);
          cluster.to = Math.max(cluster.to, run.to);
          cluster.runs.push(run);
        } else {
          clusters.push({ bundle, from: run.from, to: run.to, runs: [run] });
        }
      });
    if (clusters.length < 2) {
      return;
    }

    // Interval colouring, then centre each connected component of clusters.
    clusters.sort((a, b) => a.from - b.from || b.to - a.to);
    let component: typeof clusters = [];
    let componentEnd = -Infinity;
    const lanes = new Map<(typeof clusters)[number], number>();
    const flush = () => {
      if (component.length === 0) {
        return;
      }
      if (order) {
        assignOrderedLanes(component, lanes, (a, b) => {
          for (const ra of a.runs) {
            for (const rb of b.runs) {
              const value = compareRuns(ra, rb, horizontalGroup, at);
              if (value !== 0) {
                return value;
              }
            }
          }
          return 0;
        });
      } else {
        const laneEnds: number[] = [];
        component.forEach((cluster) => {
          let lane = laneEnds.findIndex(end => end < cluster.from - eps);
          if (lane === -1) {
            lane = laneEnds.length;
            laneEnds.push(cluster.to);
          } else {
            laneEnds[lane] = cluster.to;
          }
          lanes.set(cluster, lane);
        });
      }
      const count = Math.max(...component.map(c => lanes.get(c)!)) + 1;
      const from = Math.min(...component.map(c => c.from));
      const to = Math.max(...component.map(c => c.to));
      let [below, above] = room(horizontalGroup, at, from, to);
      if (neighbours) {
        const [nearBelow, nearAbove] = neighbourRoom(horizontalGroup, at, from, to);
        below = Math.min(below, nearBelow);
        above = Math.min(above, nearAbove);
      }
      // Keep lanes distinguishable even where symbols leave no room.
      const step = Math.max(
        minSpacing,
        Math.min(spacing, Math.max(0, below + above) / Math.max(1, count - 1)),
      );
      // Centre the lanes, then shift them into the free room if needed.
      const half = (step * (count - 1)) / 2;
      // Lanes span [centre - half, centre + half], within [-below, above]
      // when they fit.
      const centre =
        half * 2 <= below + above
          ? Math.min(Math.max(0, half - below), above - half)
          : (above - below) / 2;
      component.forEach((cluster) => {
        const offset = centre + (lanes.get(cluster)! - (count - 1) / 2) * step;
        cluster.runs.forEach((run) => {
          offsets[run.route][run.segment] = offset;
        });
      });
    };
    clusters.forEach((cluster) => {
      if (cluster.from > componentEnd + eps) {
        flush();
        component = [];
        componentEnd = -Infinity;
      }
      component.push(cluster);
      componentEnd = Math.max(componentEnd, cluster.to);
    });
    flush();
  });

  return simplified.map((points, route) => {
    if (points.length < 2) {
      return points;
    }
    const shift = offsets[route];
    const horizontal = (segment: number) =>
      Math.abs(points[segment][1] - points[segment + 1][1]) < eps;
    return points.map(([x, y], i) => {
      const before = i - 1;
      const after = i;
      let [nx, ny] = [x, y];
      for (const segment of [before, after]) {
        if (segment < 0 || segment >= shift.length) {
          continue;
        }
        if (horizontal(segment)) {
          ny = y + shift[segment];
        } else {
          nx = x + shift[segment];
        }
      }
      return [nx, ny] as Point;
    });
  });
}

interface Cluster {
  from: number;
  to: number;
}

/**
 * Assigns lanes so that every pair of overlapping clusters gets different
 * lanes, in the order `compare` asks for (ties broken by position):
 * a longest-path layering of the "below" relation.
 */
function assignOrderedLanes<C extends Cluster>(
  clusters: C[],
  lanes: Map<C, number>,
  compare: (a: C, b: C) => number,
): void {
  const below = new Map<C, C[]>(clusters.map(c => [c, []]));
  const indegree = new Map<C, number>(clusters.map(c => [c, 0]));
  clusters.forEach((a, i) => {
    clusters.slice(i + 1).forEach((b) => {
      if (Math.min(a.to, b.to) - Math.max(a.from, b.from) < -eps) {
        return;
      }
      const value = compare(a, b) || -1;
      const [low, high] = value < 0 ? [a, b] : [b, a];
      below.get(low)!.push(high);
      indegree.set(high, indegree.get(high)! + 1);
    });
  });
  const lane = new Map<C, number>(clusters.map(c => [c, 0]));
  const remaining = new Set(clusters);
  while (remaining.size > 0) {
    // Take a cluster nothing remaining must go below; on a cycle, the one
    // with the fewest such constraints.
    let next: C | undefined;
    remaining.forEach((c) => {
      if (!next || indegree.get(c)! < indegree.get(next)!) {
        next = c;
      }
    });
    remaining.delete(next!);
    lanes.set(next!, lane.get(next!)!);
    below.get(next!)!.forEach((high) => {
      if (remaining.has(high)) {
        indegree.set(high, indegree.get(high)! - 1);
        lane.set(high, Math.max(lane.get(high)!, lane.get(next!)! + 1));
      }
    });
  }
}
