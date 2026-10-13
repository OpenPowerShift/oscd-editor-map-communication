/**
 * Stage 1 of connection routing: finding a path for every connection.
 *
 * ## The lattice
 *
 * The diagram is searched on a lattice with nodes every half grid cell, so
 * that cell `[x, x + 1] × [y, y + 1]` has nodes on its corners, at the
 * midpoints of its borders and at its centre. Lattice index `(i, j)` is the
 * point `(i / 2, j / 2)`; even indices lie on cell borders, odd ones inside
 * cells. Lines may run along cell borders (between symbols) and through the
 * middle of empty cells.
 *
 * Every obstacle is rasterised onto the lattice once:
 * - symbols (IEDs, equipment) block the nodes inside their cells, and with
 *   `strictBorders` also the borders and corners squeezed between two
 *   symbols, where a line would be drawn on top of their outlines;
 * - labels mark their nodes as expensive to cross;
 * - wires (busbars, primary connections) and container borders (bays,
 *   voltage levels) mark their nodes, per orientation, as expensive to run
 *   along.
 *
 * ## The search
 *
 * Each connection is searched with A* over states (node, heading): the
 * heading is needed to charge for turns. A path starts at the midpoint of
 * one of the source IED's faces heading straight out, and ends at the
 * midpoint of one of the target IED's faces heading straight in, where the
 * arrowhead is drawn. Faces covered by a label just outside the IED (its own
 * name, usually) are not used, so arrows do not run into text.
 *
 * A step of half a cell costs 0.5 plus, as configured in `GridCosts`:
 * a turn; running along a cell border next to a symbol (`hug`, so lines keep
 * to the middle of the channels between symbols); crossing a label; running
 * along a wire or a container border; sharing a street with more lines than
 * fit (`congestion` beyond `capacity`); and crossing another line
 * (`crossing`, per line crossed).
 *
 * The heuristic is the remaining distance plus the turns still needed given
 * the current heading. It never overestimates, so with `weight` 1 the
 * search finds a cheapest path; a weight above 1 makes it greedier and much
 * faster, at the price of occasional detours.
 *
 * ## Several connections
 *
 * Connections are routed shortest first. Every routed path is recorded on
 * the lattice, so later connections pay for crossing or crowding it. As the
 * first connections cannot know about the later ones, `passes` above 1 rip
 * every connection up again and reroute it knowing where all the others go
 * (with `refineWeight`, usually 1 for an exact search).
 *
 * The cost of a search is bounded three ways: it is limited to a `window`
 * around the connection's ends (widened if that fails), to a `budget` of
 * expanded states, after which the connection is searched again ignoring
 * the other lines (cheap, as nothing then makes detours worthwhile), and
 * finally, if the IEDs are walled in, the fixed shape of `routePoints` is
 * drawn.
 */
import {
  faceDirections,
  facePoint,
  routePoints,
  type Face,
  type Obstacle,
  type Point,
  type RouteInput,
} from './routing.js';

/** Search costs, per half-cell step unless noted. */
export interface GridCosts {
  /** Extra cost per turn. */
  bend: number;
  /** Extra cost for a step through the middle of a cell. */
  interior: number;
  /** Extra cost for a step on a street, per line beyond its capacity. */
  congestion: number;
  /** Lines a street holds side by side before congestion applies. */
  capacity: number;
  /** Capacity of a street squeezed between two symbols. */
  narrowCapacity: number;
  /** Extra cost for crossing another line, per line crossed. */
  crossing: number;
  /** Extra cost for a step across a label. */
  label: number;
  /** Extra cost for a step along a busbar or primary connection. */
  wire: number;
  /** Extra cost for a step along a bay or voltage level border. */
  border: number;
  /**
   * Extra cost for a step along a cell border next to a symbol, which keeps
   * lines in the middle of the channels between symbols.
   */
  hug: number;
}

/** Plain costs: shortest paths with few turns, avoiding labels and wires. */
const defaultGridCosts: GridCosts = {
  bend: 0.8,
  interior: 0.1,
  congestion: 0.6,
  capacity: 4,
  narrowCapacity: 1,
  crossing: 0.3,
  label: 1.5,
  wire: 0.8,
  border: 0,
  hug: 0,
};

export interface GridOptions {
  costs?: Partial<GridCosts>;
  /** Margin of the search window around a connection's ends, in cells (0: none). */
  window?: number;
  /** Heuristic weight; above 1 trades optimal paths for speed. */
  weight?: number;
  /** Heuristic weight of the passes after the first (default `weight`). */
  refineWeight?: number;
  /**
   * States expanded per search before the other lines are ignored for this
   * connection (0: unlimited).
   */
  budget?: number;
  /** Routing passes; each pass after the first reroutes every connection. */
  passes?: number;
  /** Block cell borders and corners squeezed between two symbols. */
  strictBorders?: boolean;
}

export interface GridRoute {
  id: string;
  /** Lattice points of the path, from source face to target face. */
  points: Point[];
  /** False when no path was found and the fixed shape was drawn. */
  found: boolean;
}

/** Headings, indexed as in the search states. */
const directions: { face: Face; dx: number; dy: number }[] = [
  { face: 'n', dx: 0, dy: -1 },
  { face: 'e', dx: 1, dy: 0 },
  { face: 's', dx: 0, dy: 1 },
  { face: 'w', dx: -1, dy: 0 },
];

const opposite: Record<Face, Face> = { n: 's', s: 'n', e: 'w', w: 'e' };

/** Binary min-heap of integer items keyed by a float priority. */
class Heap {
  private items: number[] = [];

  private priorities: number[] = [];

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
    this.priorities.length = 0;
  }

  push(item: number, priority: number): void {
    const { items, priorities } = this;
    let i = items.length;
    items.push(item);
    priorities.push(priority);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (priorities[parent] <= priority) {
        break;
      }
      items[i] = items[parent];
      priorities[i] = priorities[parent];
      i = parent;
    }
    items[i] = item;
    priorities[i] = priority;
  }

  pop(): number {
    const { items, priorities } = this;
    const top = items[0];
    const item = items.pop()!;
    const priority = priorities.pop()!;
    const n = items.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) {
          break;
        }
        if (child + 1 < n && priorities[child + 1] < priorities[child]) {
          child += 1;
        }
        if (priorities[child] >= priority) {
          break;
        }
        items[i] = items[child];
        priorities[i] = priorities[child];
        i = child;
      }
      items[i] = item;
      priorities[i] = priority;
    }
    return top;
  }
}

/** The midpoint of an IED face, where a path starts or ends. */
interface Port {
  face: Face;
  /** Heading leaving the IED through this face. */
  dir: number;
  node: number;
  i: number;
  j: number;
}

/** Routes connections on the lattice; see the module description. */
export function gridRoute(
  inputs: RouteInput[],
  dimensions: Point,
  obstacles: Obstacle[],
  options: GridOptions = {},
): GridRoute[] {
  const steps = gridRouteSteps(inputs, dimensions, obstacles, options);
  let step = steps.next();
  while (!step.done) {
    step = steps.next();
  }
  return step.value;
}

/**
 * `gridRoute` one connection at a time: yields after each search, so a
 * caller can spread the work over several frames. Returns the routes.
 */
export function* gridRouteSteps(
  inputs: RouteInput[],
  [width, height]: Point,
  obstacles: Obstacle[],
  options: GridOptions = {},
): Generator<void, GridRoute[]> {
  const costs = { ...defaultGridCosts, ...options.costs };
  let weight = options.weight ?? 1;
  const windowMargin = (options.window ?? 0) * 2;
  const budget = options.budget ?? 0;

  const columns = Math.round(width * 2) + 1;
  const rows = Math.round(height * 2) + 1;
  const nodes = columns * rows;
  const index = (i: number, j: number) => j * columns + i;
  const inside = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < columns && j < rows;

  // Rasterise the obstacles.
  const blocked = new Uint8Array(nodes);
  const labelled = new Uint8Array(nodes);
  /**
   * Nodes on lines that should not be run along, per orientation: bits 1
   * (horizontal) and 2 (vertical) for wires, 4 and 8 for container borders.
   */
  const lined = new Uint8Array(nodes);
  const markLine = (x: number, y: number, w: number, h: number, bits: number) => {
    const horizontal = h === 0;
    const fixed = Math.round((horizontal ? y : x) * 2);
    const from = Math.ceil((horizontal ? x : y) * 2);
    const to = Math.floor((horizontal ? x + w : y + h) * 2);
    for (let k = from; k <= to; k += 1) {
      const [i, j] = horizontal ? [k, fixed] : [fixed, k];
      if (inside(i, j)) {
        lined[index(i, j)] |= horizontal ? bits : bits << 1;
      }
    }
  };
  obstacles.forEach(({ rect: [x, y, w, h], kind }) => {
    if (kind === 'border') {
      markLine(x, y, w, 0, 4);
      markLine(x, y + h, w, 0, 4);
      markLine(x, y, 0, h, 4);
      markLine(x + w, y, 0, h, 4);
      return;
    }
    if (kind === 'wire') {
      markLine(x, y, w, h, 1);
      return;
    }
    // Nodes strictly inside the rectangle.
    const target = kind === 'label' ? labelled : blocked;
    const i0 = Math.max(0, Math.floor(x * 2) + 1);
    const i1 = Math.min(columns - 1, Math.ceil((x + w) * 2) - 1);
    const j0 = Math.max(0, Math.floor(y * 2) + 1);
    const j1 = Math.min(rows - 1, Math.ceil((y + h) * 2) - 1);
    for (let i = i0; i <= i1; i += 1) {
      for (let j = j0; j <= j1; j += 1) {
        target[index(i, j)] = 1;
      }
    }
  });

  if (options.strictBorders) {
    const symbols = blocked.slice();
    const symbol = (i: number, j: number) =>
      inside(i, j) ? symbols[index(i, j)] : 0;
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < columns; i += 1) {
        const corner = i % 2 === 0 && j % 2 === 0;
        const between = corner
          ? symbol(i - 1, j - 1) +
              symbol(i + 1, j - 1) +
              symbol(i - 1, j + 1) +
              symbol(i + 1, j + 1) >=
            3
          : i % 2 === 0
            ? symbol(i - 1, j) && symbol(i + 1, j)
            : j % 2 === 0 && symbol(i, j - 1) && symbol(i, j + 1);
        if (between) {
          blocked[index(i, j)] = 1;
        }
      }
    }
  }

  const isSymbol = (i: number, j: number) =>
    inside(i, j) && blocked[index(i, j)] === 1;

  /**
   * For a step along a cell border, the centres of the two cells on either
   * side of it; `undefined` for steps through cell interiors.
   */
  const sides = (
    i: number,
    j: number,
    dir: number,
  ): [[number, number], [number, number]] | undefined => {
    const { dx, dy } = directions[dir];
    if (dx !== 0) {
      if (j % 2 === 1) {
        return undefined;
      }
      const ci = i % 2 === 1 ? i : i + dx;
      return [
        [ci, j - 1],
        [ci, j + 1],
      ];
    }
    if (i % 2 === 1) {
      return undefined;
    }
    const cj = j % 2 === 1 ? j : j + dy;
    return [
      [i - 1, cj],
      [i + 1, cj],
    ];
  };
  /** A step along a border with a symbol on at least one side. */
  const hugs = (i: number, j: number, dir: number) =>
    sides(i, j, dir)?.some(([ci, cj]) => isSymbol(ci, cj)) ?? false;
  /** A step along a border squeezed between two symbols. */
  const isNarrow = (i: number, j: number, dir: number) =>
    sides(i, j, dir)?.every(([ci, cj]) => isSymbol(ci, cj)) ?? false;

  /**
   * Routes using each lattice edge and passing each node, with how often:
   * edge key = lower node * 2 + (vertical ? 1 : 0), node key = node * 2 +
   * (passed vertically ? 1 : 0).
   */
  const edgeUsers = new Map<number, Map<number, number>>();
  const nodeUsers = new Map<number, Map<number, number>>();
  const use = (
    users: Map<number, Map<number, number>>,
    key: number,
    route: number,
    delta: number,
  ) => {
    let counts = users.get(key);
    if (!counts) {
      counts = new Map();
      users.set(key, counts);
    }
    const count = (counts.get(route) ?? 0) + delta;
    if (count > 0) {
      counts.set(route, count);
    } else {
      counts.delete(route);
    }
  };
  /** How many routes other than `route` are recorded. */
  const others = (users: Map<number, number> | undefined, route: number) =>
    users ? users.size - (users.has(route) ? 1 : 0) : 0;
  const edgeKey = (node: number, dir: number) => {
    const { dx, dy } = directions[dir];
    const lower = dx < 0 ? node - 1 : dy < 0 ? node - columns : node;
    return lower * 2 + (dy !== 0 ? 1 : 0);
  };

  /** The usable face midpoints of an IED at grid position `[x, y]`. */
  const portsOf = ([x, y]: Point): Port[] => {
    const ci = Math.round(x * 2) + 1;
    const cj = Math.round(y * 2) + 1;
    const ports = directions
      .map(({ face, dx, dy }, dir) => {
        const i = ci + dx;
        const j = cj + dy;
        return { face, dir, i, j, node: index(i, j) };
      })
      .filter(({ i, j }) => inside(i, j));
    // Faces with a label right outside are only used when all have one.
    const clear = ports.filter(({ i, j, dir }) => {
      const oi = i + directions[dir].dx;
      const oj = j + directions[dir].dy;
      return !inside(oi, oj) || labelled[index(oi, oj)] === 0;
    });
    return clear.length > 0 ? clear : ports;
  };

  // Search state arrays, reset lazily through `touched`.
  const gScore = new Float64Array(nodes * 4).fill(Infinity);
  const parent = new Int32Array(nodes * 4).fill(-1);
  const closed = new Uint8Array(nodes * 4);
  const touched: number[] = [];
  const heap = new Heap();

  /**
   * A* from the source ports to the target ports. Returns the goal state, or
   * -1 when none was reached within the bounds (or budget). `relaxed`
   * ignores other routes and the budget.
   */
  const search = (
    sources: Port[],
    targets: Port[],
    route: number,
    bounds: [number, number, number, number] | null,
    relaxed = false,
  ): number => {
    touched.forEach((state) => {
      gScore[state] = Infinity;
      parent[state] = -1;
      closed[state] = 0;
    });
    touched.length = 0;
    heap.clear();

    const goals = new Map(targets.map(port => [port.node, port]));
    // The target IED's centre.
    const ti = targets.reduce((sum, t) => sum + t.i, 0) / targets.length;
    const tj = targets.reduce((sum, t) => sum + t.j, 0) / targets.length;
    /**
     * Lower bound of the remaining cost: the distance to the target's ports
     * plus the turns still needed. Two turns when the target lies behind
     * along the heading's axis, one when it lies off that axis.
     */
    const heuristic = (node: number, heading: number) => {
      const i = node % columns;
      const j = (node - i) / columns;
      const dx = ti - i;
      const dy = tj - j;
      const farX = Math.abs(dx) > 1;
      const farY = Math.abs(dy) > 1;
      let turns = 0;
      if (farX || farY) {
        const { dx: hx, dy: hy } = directions[heading];
        const ahead = hx * dx + hy * dy;
        const alongX = hx !== 0;
        if (farX && farY) {
          turns = ahead < 0 ? 2 : 1;
        } else if (farX === alongX) {
          turns = ahead > 0 ? 0 : 2;
        } else {
          turns = 1;
        }
      }
      const distance = Math.max(0, Math.abs(dx) + Math.abs(dy) - 1) * 0.5;
      return (distance + turns * costs.bend) * weight;
    };

    sources.forEach(({ node, dir }) => {
      const state = node * 4 + dir;
      gScore[state] = 0;
      touched.push(state);
      heap.push(state, heuristic(node, dir));
    });

    let expanded = 0;
    while (heap.size > 0) {
      const state = heap.pop();
      if (closed[state]) {
        continue;
      }
      closed[state] = 1;
      expanded += 1;
      if (budget > 0 && !relaxed && expanded > budget) {
        return -1;
      }
      const node = state >> 2;
      const heading = state & 3;
      // A target face is reached heading straight into the IED.
      const goal = goals.get(node);
      if (goal && directions[heading].face === opposite[goal.face]) {
        return state;
      }
      const i = node % columns;
      const j = (node - i) / columns;
      for (let dir = 0; dir < 4; dir += 1) {
        if (dir === (heading + 2) % 4) {
          continue;
        }
        const { dx, dy } = directions[dir];
        const ni = i + dx;
        const nj = j + dy;
        if (
          !inside(ni, nj) ||
          (bounds &&
            (ni < bounds[0] || nj < bounds[1] || ni > bounds[2] || nj > bounds[3]))
        ) {
          continue;
        }
        const next = index(ni, nj);
        if (blocked[next]) {
          continue;
        }
        const vertical = dy !== 0;
        let step = 0.5;
        if ((vertical ? i : j) % 2 === 1) {
          step += costs.interior;
        }
        if (labelled[next]) {
          step += costs.label;
        }
        if (costs.hug > 0 && hugs(i, j, dir)) {
          step += costs.hug;
        }
        const wire = vertical ? 2 : 1;
        if (lined[node] & lined[next] & wire) {
          step += costs.wire;
        }
        if (lined[node] & lined[next] & (wire << 2)) {
          step += costs.border;
        }
        if (!relaxed) {
          const sharing = others(edgeUsers.get(edgeKey(node, dir)), route);
          if (sharing > 0) {
            const capacity = isNarrow(i, j, dir)
              ? costs.narrowCapacity
              : costs.capacity;
            step += Math.max(0, sharing - capacity + 1) * costs.congestion;
          }
          // Lines passing the next node the other way are crossed.
          step +=
            others(nodeUsers.get(next * 2 + (vertical ? 0 : 1)), route) *
            costs.crossing;
        }
        if (dir !== heading) {
          step += costs.bend;
        }
        const nextState = next * 4 + dir;
        const g = gScore[state] + step;
        if (g < gScore[nextState]) {
          if (gScore[nextState] === Infinity && parent[nextState] === -1) {
            touched.push(nextState);
          }
          gScore[nextState] = g;
          parent[nextState] = state;
          heap.push(nextState, g + heuristic(next, dir));
        }
      }
    }
    return -1;
  };

  const toPoint = (node: number): Point => {
    const i = node % columns;
    return [i / 2, (node - i) / columns / 2];
  };

  // Shortest connections first: they have the fewest alternatives.
  const order = inputs
    .map((input, k) => ({
      input,
      k,
      distance:
        Math.abs(input.source.position[0] - input.target.position[0]) +
        Math.abs(input.source.position[1] - input.target.position[1]),
    }))
    .sort((a, b) => a.distance - b.distance);

  const results = new Array<GridRoute>(inputs.length);
  /** Edge and node keys each route recorded, to rip it up again. */
  const usage: { edges: number[]; nodes: number[] }[] = [];

  const routeOne = (input: RouteInput, k: number) => {
    usage[k]?.edges.forEach(edge => use(edgeUsers, edge, k, -1));
    usage[k]?.nodes.forEach(node => use(nodeUsers, node, k, -1));
    usage[k] = { edges: [], nodes: [] };

    const sources = portsOf(input.source.position);
    const targets = portsOf(input.target.position);
    let bounds: [number, number, number, number] | null = null;
    if (windowMargin > 0) {
      const ends = [...sources, ...targets];
      bounds = [
        Math.min(...ends.map(p => p.i)) - windowMargin,
        Math.min(...ends.map(p => p.j)) - windowMargin,
        Math.max(...ends.map(p => p.i)) + windowMargin,
        Math.max(...ends.map(p => p.j)) + windowMargin,
      ];
    }
    let goal = search(sources, targets, k, bounds);
    if (goal === -1 && bounds) {
      goal = search(sources, targets, k, null);
    }
    if (goal === -1 && budget > 0) {
      // Out of budget, typically surrounded by other lines: ignore them.
      goal = search(sources, targets, k, null, true);
    }

    if (goal === -1) {
      // Walled in: draw the fixed shape.
      const faces = faceDirections(input.source.position, input.target.position);
      results[k] = {
        id: input.id,
        points: routePoints(
          facePoint(input.source.position, faces.source, 0.5),
          facePoint(input.target.position, faces.target, 0.5),
          faces,
        ),
        found: false,
      };
      return;
    }

    const states: number[] = [];
    for (let state = goal; state !== -1; state = parent[state]) {
      states.unshift(state);
    }
    for (let n = 1; n < states.length; n += 1) {
      const from = states[n - 1] >> 2;
      const dir = states[n] & 3;
      const edge = edgeKey(from, dir);
      use(edgeUsers, edge, k, 1);
      usage[k].edges.push(edge);
      for (const node of [from, states[n] >> 2]) {
        const key = node * 2 + (directions[dir].dy !== 0 ? 1 : 0);
        use(nodeUsers, key, k, 1);
        usage[k].nodes.push(key);
      }
    }
    results[k] = {
      id: input.id,
      points: states.map(state => toPoint(state >> 2)),
      found: true,
    };
  };

  const passes = Math.max(1, options.passes ?? 1);
  for (let pass = 0; pass < passes; pass += 1) {
    if (pass > 0) {
      weight = options.refineWeight ?? weight;
    }
    for (const { input, k } of order) {
      routeOne(input, k);
      yield;
    }
  }
  return results;
}
