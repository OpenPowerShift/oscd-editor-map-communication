import type { Point } from './routing.js';

/** Distance from a point to a polyline. */
export function distanceToPolyline([px, py]: Point, points: Point[]): number {
  if (points.length === 0) {
    return Infinity;
  }
  let best = Infinity;
  for (let i = 0; i < Math.max(1, points.length - 1); i += 1) {
    const [ax, ay] = points[i];
    const [bx, by] = points[Math.min(i + 1, points.length - 1)];
    const dx = bx - ax;
    const dy = by - ay;
    const length = dx * dx + dy * dy;
    const t =
      length === 0
        ? 0
        : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

/**
 * Ids of the routes passing within `tolerance` of a point, nearest first.
 * Used to pick lines drawn close together, where the pointer may be over
 * several of them at once.
 */
export function pickRoutes(
  routes: { id: string; points: Point[] }[],
  point: Point,
  tolerance: number,
): string[] {
  return routes
    .map(({ id, points }) => ({ id, distance: distanceToPolyline(point, points) }))
    .filter(({ distance }) => distance <= tolerance)
    .sort((a, b) => a.distance - b.distance)
    .map(({ id }) => id);
}
