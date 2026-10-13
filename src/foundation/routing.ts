/**
 * Shared vocabulary and geometry of connection routing.
 *
 * Coordinates are in grid cells of the single line diagram, y pointing
 * down. An IED placed at `[x, y]` occupies the cell `[x, x + 1] × [y, y + 1]`
 * and connects through the midpoints of its four faces. Routes are
 * orthogonal polylines from the source IED's face to the target IED's face;
 * this module turns them into SVG (rounded corners, arrowheads) and
 * provides the simple face choice used where no search is made.
 *
 * How routes are found is described in `connection-routing.ts` and
 * `docs/routing.md`.
 *
 * Pure functions only: no DOM, no Lit.
 */

export type Point = [number, number];

/** A face of an IED cell: north, south, east or west. */
export type Face = 'n' | 's' | 'e' | 'w';

/** `[x, y, width, height]` in grid cells. */
export type Rect = [number, number, number, number];

/** Something drawn on the diagram that lines should keep away from. */
export interface Obstacle {
  /** Name of the IED, for IED cells and IED labels. */
  ied?: string;
  rect: Rect;
  /**
   * How it is avoided:
   * - `symbol` (default): IEDs and equipment, never crossed;
   * - `label`: text, crossed only when there is no other way;
   * - `wire`: busbars and primary connections (zero width or height),
   *   preferably not run along;
   * - `border`: bay and voltage level outlines, preferably not run along.
   */
  kind?: 'symbol' | 'label' | 'wire' | 'border';
}

/** One end of a connection. */
export interface RouteEndpoint {
  /** Identifies the IED. */
  key: string;
  /** Grid position of the IED's top-left corner. */
  position: Point;
}

/** A connection to route. */
export interface RouteInput {
  id: string;
  source: RouteEndpoint;
  target: RouteEndpoint;
}

/** A routed connection, ready to draw. */
export interface RoutedConnection {
  id: string;
  /** SVG path data of the line. */
  path: string;
  /** SVG path data of the arrowhead at the target. */
  arrow: string;
  /** Corner points of the route, from source to target. */
  points: Point[];
}

const eps = 1e-6;
const cornerRadius = 0.15;
const arrowLength = 0.16;
const arrowHalfWidth = 0.08;

/** Drops repeated points and points in the middle of straight runs. */
export function simplify(points: Point[]): Point[] {
  const result: Point[] = [];
  points.forEach((point) => {
    const last = result[result.length - 1];
    if (
      last &&
      Math.abs(last[0] - point[0]) < eps &&
      Math.abs(last[1] - point[1]) < eps
    ) {
      return;
    }
    const previous = result[result.length - 2];
    if (
      previous &&
      last &&
      ((Math.abs(previous[0] - last[0]) < eps &&
        Math.abs(last[0] - point[0]) < eps) ||
        (Math.abs(previous[1] - last[1]) < eps &&
          Math.abs(last[1] - point[1]) < eps))
    ) {
      result[result.length - 1] = point;
      return;
    }
    result.push(point);
  });
  return result;
}

/**
 * The faces a connection leaves its source and enters its target by when
 * no search is made, from the relative positions of the two cells (as the
 * original communication editor did): vertically between rows, over the
 * top within a row, around the west side between neighbouring rows of one
 * column.
 */
export function faceDirections(
  [sx, sy]: Point,
  [tx, ty]: Point,
): { source: Face; target: Face } {
  const dy = sy - ty;
  if (dy === 0 && sx !== tx) {
    return { source: 'n', target: 'n' };
  }
  if (Math.abs(dy) === 1) {
    if (sx === tx) {
      return { source: 'w', target: 'w' };
    }
    return { source: dy > 0 ? 'n' : 's', target: sx < tx ? 'w' : 'e' };
  }
  return dy > 0 ? { source: 'n', target: 's' } : { source: 's', target: 'n' };
}

/** The point on a cell's face at the given fraction along it. */
export function facePoint([x, y]: Point, face: Face, offset: number): Point {
  switch (face) {
    case 'n':
      return [x + offset, y];
    case 's':
      return [x + offset, y + 1];
    case 'w':
      return [x, y + offset];
    default:
      return [x + 1, y + offset];
  }
}

/**
 * The fixed Z or L shaped route between two attachment points on the given
 * faces (see `faceDirections`).
 */
export function routePoints(
  start: Point,
  end: Point,
  faces: { source: Face; target: Face },
): Point[] {
  const [x1, y1] = start;
  const [x2, y2] = end;

  if (faces.source === 'n' && faces.target === 'n') {
    const top = y1 - 0.5;
    return [start, [x1, top], [x2, top], end];
  }
  if (faces.source === 'w') {
    const left = x1 - 0.5;
    return [start, [left, y1], [left, y2], end];
  }
  if (faces.target === 'e' || faces.target === 'w') {
    return [start, [x1, y2], end];
  }
  if (x1 === x2) {
    return [start, end];
  }
  const middle = (y1 + y2) / 2;
  return [start, [x1, middle], [x2, middle], end];
}

/** The face of its target a route's last segment enters by. */
export function entryFace(points: Point[]): Face {
  const [x1, y1] = points[points.length - 2];
  const [x2, y2] = points[points.length - 1];
  if (Math.abs(x1 - x2) < eps) {
    return y2 > y1 ? 'n' : 's';
  }
  return x2 > x1 ? 'w' : 'e';
}

function format(value: number): string {
  return String(Number(value.toFixed(3)));
}

function pointText([x, y]: Point): string {
  return `${format(x)},${format(y)}`;
}

function distance([ax, ay]: Point, [bx, by]: Point): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function unit([ax, ay]: Point, [bx, by]: Point): Point {
  const length = distance([ax, ay], [bx, by]);
  return [(bx - ax) / length, (by - ay) / length];
}

/**
 * Draws an orthogonal polyline with rounded corners. A corner's radius is
 * limited so that arcs never overrun a segment: an end segment may be used
 * fully by its one corner, an inner segment is shared by two.
 */
export function roundedPath(points: Point[], radius = cornerRadius): string {
  const commands = [`M${pointText(points[0])}`];
  const last = points.length - 1;
  const allowance = (from: number) => {
    const length = distance(points[from], points[from + 1]);
    return from === 0 || from + 1 === last ? length : length / 2;
  };

  for (let i = 1; i < last; i += 1) {
    const corner = points[i];
    const dirIn = unit(points[i - 1], corner);
    const dirOut = unit(corner, points[i + 1]);
    const r = Math.min(radius, allowance(i - 1), allowance(i));
    const start: Point = [corner[0] - dirIn[0] * r, corner[1] - dirIn[1] * r];
    const end: Point = [corner[0] + dirOut[0] * r, corner[1] + dirOut[1] * r];
    const sweep = dirIn[0] * dirOut[1] - dirIn[1] * dirOut[0] > 0 ? 1 : 0;
    commands.push(
      `L${pointText(start)}`,
      `A${format(r)},${format(r)} 0 0 ${sweep} ${pointText(end)}`,
    );
  }
  commands.push(`L${pointText(points[last])}`);
  return commands.join('');
}

/** An arrowhead with its tip at `tip`, entering the target through `face`. */
export function arrowPath([x, y]: Point, face: Face): string {
  const l = arrowLength;
  const w = arrowHalfWidth;
  const corners: Record<Face, [Point, Point]> = {
    n: [
      [x - w, y - l],
      [x + w, y - l],
    ],
    s: [
      [x - w, y + l],
      [x + w, y + l],
    ],
    e: [
      [x + l, y + w],
      [x + l, y - w],
    ],
    w: [
      [x - l, y + w],
      [x - l, y - w],
    ],
  };
  const [a, b] = corners[face];
  return `M${pointText([x, y])}L${pointText(a)}L${pointText(b)}Z`;
}

/** A routed connection drawn along `points`. */
export function drawRoute(id: string, points: Point[]): RoutedConnection {
  return {
    id,
    points,
    path: roundedPath(points),
    arrow: arrowPath(points[points.length - 1], entryFace(points)),
  };
}
