/**
 * Test support: measures of how readable a set of routes is (crossings,
 * lines drawn on top of or too close to each other, lines through symbols,
 * labels and along busbars). The routing specs use them to guard quality;
 * docs/routing.md reports them for real files.
 */
import { simplify, type Obstacle, type Point } from '../foundation/routing.js';

/** A route as measured: its polyline and what it may share lines with. */
export interface MeasuredRoute {
  id: string;
  /** Routes of the same group may overlap without ambiguity. */
  bundle: string;
  points: Point[];
  /** Names of the IEDs the route connects; their cells are not obstacles. */
  ends: [string, string];
}

export interface RoutingMetrics {
  routes: number;
  /** Sum of all route lengths (grid units). */
  length: number;
  /** Total drawn length after merging overlapping collinear lines. */
  ink: number;
  bends: number;
  /** Proper crossings between routes of different bundles. */
  crossings: number;
  /** Pairs of bundles that cross at least once (insensitive to lanes). */
  crossingPairs: number;
  /** Collinear overlap between routes of different bundles (ambiguous). */
  overlap: number;
  /** Parallel runs of different bundles closer than `minSpacing`. */
  crowded: number;
  /** Route length drawn across IEDs or equipment other than its own ends. */
  intrusion: number;
  /** Route length drawn across labels. */
  labelIntrusion: number;
  /** Route length drawn along primary wiring (busbars, connections). */
  wireOverlap: number;
}

interface Segment {
  route: number;
  horizontal: boolean;
  /** y for horizontal segments, x for vertical ones. */
  at: number;
  from: number;
  to: number;
}

const eps = 1e-6;
/** Lines closer than this cannot be told apart at normal zoom. */
export const minSpacing = 0.1;
/** Lines closer than this are treated as drawn on top of each other. */
const sameLine = 0.03;

function segments(routes: MeasuredRoute[]): Segment[] {
  const result: Segment[] = [];
  routes.forEach((route, index) => {
    const points = simplify(route.points);
    for (let i = 1; i < points.length; i += 1) {
      const [x1, y1] = points[i - 1];
      const [x2, y2] = points[i];
      const horizontal = Math.abs(y1 - y2) < eps;
      result.push({
        route: index,
        horizontal,
        at: horizontal ? y1 : x1,
        from: horizontal ? Math.min(x1, x2) : Math.min(y1, y2),
        to: horizontal ? Math.max(x1, x2) : Math.max(y1, y2),
      });
    }
  });
  return result;
}

function overlapLength(a: Segment, b: Segment): number {
  return Math.max(0, Math.min(a.to, b.to) - Math.max(a.from, b.from));
}

function mergedLength(intervals: [number, number][]): number {
  const sorted = intervals.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [start, end] = sorted[0] ?? [0, 0];
  sorted.slice(1).forEach(([from, to]) => {
    if (from > end) {
      total += end - start;
      [start, end] = [from, to];
    } else {
      end = Math.max(end, to);
    }
  });
  return total + (end - start);
}

/** Length of a segment inside a rectangle, shrunk slightly so lines running along a border do not count. */
function insideLength(segment: Segment, [x, y, w, h]: Obstacle['rect']): number {
  const inset = 0.05;
  const [lo, hi, atLo, atHi] = segment.horizontal
    ? [x + inset, x + w - inset, y + inset, y + h - inset]
    : [y + inset, y + h - inset, x + inset, x + w - inset];
  if (segment.at <= atLo || segment.at >= atHi) {
    return 0;
  }
  return Math.max(0, Math.min(segment.to, hi) - Math.max(segment.from, lo));
}

/** Measures how readable a set of routes is. Pure and O(segments²). */
export function measureRoutes(
  routes: MeasuredRoute[],
  obstacles: Obstacle[] = [],
): RoutingMetrics {
  const all = segments(routes);
  const bundle = (segment: Segment) => routes[segment.route].bundle;
  const horizontal = all.filter(s => s.horizontal);
  const vertical = all.filter(s => !s.horizontal);

  let crossings = 0;
  const crossingPairs = new Set<string>();
  horizontal.forEach((h) => {
    vertical.forEach((v) => {
      if (
        bundle(h) !== bundle(v) &&
        v.at > h.from + eps &&
        v.at < h.to - eps &&
        h.at > v.from + eps &&
        h.at < v.to - eps
      ) {
        crossings += 1;
        crossingPairs.add([bundle(h), bundle(v)].sort().join('\u0000'));
      }
    });
  });

  let overlap = 0;
  let crowded = 0;
  for (const group of [horizontal, vertical]) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = group[i];
        const b = group[j];
        if (bundle(a) === bundle(b)) {
          continue;
        }
        const distance = Math.abs(a.at - b.at);
        if (distance < sameLine) {
          overlap += overlapLength(a, b);
        } else if (distance < minSpacing) {
          crowded += overlapLength(a, b);
        }
      }
    }
  }

  const lines = new Map<string, [number, number][]>();
  all.forEach((s) => {
    const key = `${s.horizontal ? 'h' : 'v'}${Math.round(s.at / sameLine)}`;
    if (!lines.has(key)) {
      lines.set(key, []);
    }
    lines.get(key)!.push([s.from, s.to]);
  });
  const ink = Array.from(lines.values()).reduce(
    (sum, intervals) => sum + mergedLength(intervals),
    0,
  );

  let intrusion = 0;
  let labelIntrusion = 0;
  let wireOverlap = 0;
  all.forEach((segment) => {
    const ends = routes[segment.route].ends;
    obstacles.forEach((obstacle) => {
      if (obstacle.kind === 'border') {
        return;
      }
      if (obstacle.kind === 'wire') {
        const [x, y, w, h] = obstacle.rect;
        const horizontalWire = h === 0;
        if (segment.horizontal === horizontalWire) {
          const at = horizontalWire ? y : x;
          const [from, to] = horizontalWire ? [x, x + w] : [y, y + h];
          if (Math.abs(segment.at - at) < minSpacing) {
            wireOverlap += Math.max(
              0,
              Math.min(segment.to, to) - Math.max(segment.from, from),
            );
          }
        }
      } else if (obstacle.kind === 'label') {
        labelIntrusion += insideLength(segment, obstacle.rect);
      } else if (obstacle.ied === undefined || !ends.includes(obstacle.ied)) {
        intrusion += insideLength(segment, obstacle.rect);
      }
    });
  });

  const round = (value: number) => Number(value.toFixed(2));
  return {
    routes: routes.length,
    length: round(all.reduce((sum, s) => sum + s.to - s.from, 0)),
    ink: round(ink),
    bends: routes.reduce(
      (sum, route) => sum + Math.max(0, simplify(route.points).length - 2),
      0,
    ),
    crossings,
    crossingPairs: crossingPairs.size,
    overlap: round(overlap),
    crowded: round(crowded),
    intrusion: round(intrusion),
    labelIntrusion: round(labelIntrusion),
    wireOverlap: round(wireOverlap),
  };
}
