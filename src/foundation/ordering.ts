import { simplify, type Point } from './routing.js';

/**
 * Stage 2 of connection routing (see `connection-routing.ts` and
 * `docs/routing.md`): orders routes that share a path, so the parallel
 * lanes they get when nudged apart do not cross needlessly.
 *
 * Two routes running together along a path must keep one side each: the
 * route that joins the path from the left (relative to the direction of
 * travel) and leaves it to the left stays left all along, also around
 * bends. Routes joining from one side and leaving to the other have to
 * cross once; the order is then chosen by where they leave. This is the
 * ordering step of orthogonal connector routing (Wybrow, Marriott and
 * Stuckey, 2009).
 */

/** Spacing of the routing lattice the routes are drawn on. */
const step = 0.5;
const eps = 1e-6;

function key([x, y]: Point): string {
  return `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
}

/** Points of a route at every lattice coordinate it passes. */
export function densify(points: Point[]): Point[] {
  const simple = simplify(points);
  const dense: Point[] = simple.slice(0, 1);
  for (let i = 1; i < simple.length; i += 1) {
    const [x1, y1] = simple[i - 1];
    const [x2, y2] = simple[i];
    const horizontal = Math.abs(y1 - y2) < eps;
    const [from, to] = horizontal ? [x1, x2] : [y1, y2];
    const direction = Math.sign(to - from);
    for (
      let at = direction > 0
        ? Math.floor(from / step + eps + 1) * step
        : Math.ceil(from / step - eps - 1) * step;
      direction * (to - at) > eps;
      at += direction * step
    ) {
      dense.push(horizontal ? [at, y1] : [x1, at]);
    }
    dense.push(simple[i]);
  }
  return dense;
}

/** Key of the lattice edge between two points, independent of direction. */
export function edgeKey(a: Point, b: Point): string {
  const [p, q] = a[0] + a[1] <= b[0] + b[1] ? [a, b] : [b, a];
  return `${key(p)}|${key(q)}`;
}

function sideOf(direction: Point, from: Point, to?: Point): number {
  if (!to) {
    return 0;
  }
  const vx = to[0] - from[0];
  const vy = to[1] - from[1];
  return Math.sign(direction[0] * vy - direction[1] * vx);
}

function along(from: Point, to: Point): Point {
  return [Math.sign(to[0] - from[0]), Math.sign(to[1] - from[1])];
}

/**
 * Which of two routes should run on the side of larger coordinates (y for
 * horizontal, x for vertical edges) where they share an edge.
 */
export interface RouteOrder {
  /**
   * `1` when route `a` should have the larger perpendicular coordinate
   * than route `b` on the edge, `-1` when smaller, `0` when they do not
   * share it.
   */
  compare(a: number, b: number, edge: string): number;
}

/** Computes the order of every pair of routes along their shared paths. */
export function orderRoutes(routes: Point[][]): RouteOrder {
  const dense = routes.map(densify);
  const keys = dense.map(points => points.map(key));
  /** Edge key to the routes using it and where. */
  const edges = new Map<string, { route: number; index: number }[]>();
  dense.forEach((points, route) => {
    for (let index = 0; index + 1 < points.length; index += 1) {
      const edge = edgeKey(points[index], points[index + 1]);
      if (!edges.has(edge)) {
        edges.set(edge, []);
      }
      edges.get(edge)!.push({ route, index });
    }
  });

  const order = new Map<string, number>();
  const set = (a: number, b: number, edge: string, value: number) => {
    order.set(`${edge}|${a}|${b}`, value);
    order.set(`${edge}|${b}|${a}`, -value);
  };

  edges.forEach((users, edge) => {
    for (let u = 0; u < users.length; u += 1) {
      for (let v = u + 1; v < users.length; v += 1) {
        const a = users[u];
        const b = users[v];
        if (a.route === b.route || order.has(`${edge}|${a.route}|${b.route}`)) {
          continue;
        }
        const A = dense[a.route];
        const B = dense[b.route];
        const ka = keys[a.route];
        const kb = keys[b.route];
        // B's index of A's node at a.index, and B's direction relative to A.
        const forward = kb[b.index] === ka[a.index];
        const sign = forward ? 1 : -1;
        let i0 = a.index;
        let j0 = forward ? b.index : b.index + 1;
        let i1 = a.index + 1;
        let j1 = j0 + sign;
        while (i0 > 0 && kb[j0 - sign] !== undefined && ka[i0 - 1] === kb[j0 - sign]) {
          i0 -= 1;
          j0 -= sign;
        }
        while (
          i1 + 1 < A.length &&
          kb[j1 + sign] !== undefined &&
          ka[i1 + 1] === kb[j1 + sign]
        ) {
          i1 += 1;
          j1 += sign;
        }

        const enter = along(A[i0], A[i0 + 1]);
        const leave = along(A[i1 - 1], A[i1]);
        const start =
          sideOf(enter, A[i0], A[i0 - 1]) - sideOf(enter, A[i0], B[j0 - sign]);
        const end =
          sideOf(leave, A[i1], A[i1 + 1]) - sideOf(leave, A[i1], B[j1 + sign]);
        // Positive: A runs on the left of B, seen in A's direction of travel.
        const left = Math.sign(end) || Math.sign(start) || (a.route < b.route ? 1 : -1);

        for (let i = i0; i < i1; i += 1) {
          const [dx, dy] = along(A[i], A[i + 1]);
          // The left normal (-dy, dx) points to larger coordinates when its
          // components sum to a positive value.
          set(a.route, b.route, edgeKey(A[i], A[i + 1]), left * Math.sign(dx - dy));
        }
      }
    }
  });

  return {
    compare: (a, b, edge) => order.get(`${edge}|${a}|${b}`) ?? 0,
  };
}
