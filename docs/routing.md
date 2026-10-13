# How connections are routed

The map draws every GOOSE, Sampled Value and Report connection as its own
line from the publishing (or reporting) IED to the receiving IED. With
dozens of connections around a few protection IEDs, the routing decides
whether the map can be read at all. This page explains how lines are
routed, why, and how the choices were measured.

## Goals

In order of importance:

1. **Every connection can be told apart and picked.** Lines never run on top
   of each other; lines sharing a path run side by side in lanes.
2. **Lines stay off the diagram's content.** They never cross IED or
   equipment symbols, and avoid labels, busbars and bay outlines.
3. **Few crossings and few bends**, so a line can be followed by eye.
4. **Fast enough to stay interactive**: changing a filter or selecting an
   IED should redraw within a fraction of a second.

## Overview

The approach follows orthogonal connector routing (Wybrow, Marriott and
Stuckey, *Orthogonal connector routing*, Graph Drawing 2009, as implemented
in libavoid), adapted to the grid of the single line diagram:

```text
 connections ──► 1. search ──► 2. order ──► 3. nudge ──► draw
                 grid-router     ordering      nudge       routing
                 (A* per line)   (sides of     (lanes in   (rounded corners,
                                 shared paths)  channels)    arrowheads)
```

| Stage | File | What it decides |
| --- | --- | --- |
| Pipeline | [`connection-routing.ts`](../src/foundation/connection-routing.ts) | settings, synchronous and time-sliced routing, quick preview |
| 1. Search | [`grid-router.ts`](../src/foundation/grid-router.ts) | which streets each line uses |
| 2. Order | [`ordering.ts`](../src/foundation/ordering.ts) | which side each line keeps where lines share a street |
| 3. Nudge | [`nudge.ts`](../src/foundation/nudge.ts) | the exact position of every lane |
| Drawing | [`routing.ts`](../src/foundation/routing.ts) | shared types, obstacles, rounded corners, arrowheads |
| Measures | [`routing-metrics.ts`](../src/testing/routing-metrics.ts) | crossings, overlap, intrusion; test support used by the specs |

The obstacles come from the diagram
(`diagramObstacles` in [`oscd-editor-map-communication.ts`](../src/oscd-editor-map-communication.ts)):
IED cells and equipment symbols, the labels of IEDs, equipment, bays and
voltage levels (estimated from their text length), busbar and connection
wires, and bay and voltage level outlines.

## 1. Search

### The lattice

IEDs sit on grid cells and connect through the midpoints of their faces.
The search runs on a lattice with a node every half cell: on cell corners,
on the midpoints of cell borders, and at cell centres. Lines can therefore
run along cell borders or through the middle of a free row or column of
cells, which is where the room between symbols usually is.

Obstacles are drawn onto the lattice once per routing:

- **Symbols** (IEDs, equipment) block the nodes inside them. With
  `strictBorders`, borders and corners squeezed between two symbols are
  blocked too; a line there would be drawn on top of their outlines.
- **Labels** make their nodes expensive to cross.
- **Wires** (busbars, primary connections) and **container borders** make
  running *along* them expensive. Crossing them is free: a line must cross a
  busbar to get from one side to the other.

### Costs

Each connection is found with A* over states *(node, heading)*; the heading
is needed to charge for turns. A path starts at the midpoint of one of the
source IED's faces, heading straight out, and ends heading straight into one
of the target IED's faces, where the arrowhead goes. Faces with a label right
outside, usually the IED's own name, are not used, so arrows do not run into
text.

A step of half a cell costs 0.5 plus:

| Cost | Value | Why |
| --- | --- | --- |
| `bend` | 1.2 per turn | Few corners: each costs as much as 1.2 cells of detour |
| `hug` | 0.35 | Running along a symbol's outline: keeps lines in the middle of channels, with room for lanes on both sides |
| `interior` | 0 | Running through the middle of free cells is welcome |
| `crossing` | 1.5 per line crossed | The main lever against crossings |
| `congestion` / `capacity` | 0.4 per line beyond 6 (1 between two symbols) | Lets lines share a street (they become lanes) until it is full |
| `label` | 2.5 | Labels are crossed only to avoid a long detour |
| `wire` | 2 | Lines along a busbar would hide it |
| `border` | 0.6 | Lines along a dashed bay outline are hard to follow |

The search's estimate of the remaining cost is the distance to the target
plus the turns still needed given the current heading. It never
overestimates, so the search with weight 1 finds a cheapest path.

### Several connections: order and rip-up

Connections are routed shortest first. Each routed path is recorded, so
later connections pay for crossing or crowding it. The first connections
cannot know about the later ones, so a **second pass rips every connection
up and reroutes it** knowing where all the others go. This removes most
crossings caused by routing order.

### Keeping it fast

- **Weighted first pass.** The first pass multiplies the estimate by 1.2,
  which makes the search much greedier and faster. The second pass searches
  exactly (weight 1): a weighted search can settle for detours on long
  straight runs, such as hooking into the top of an IED instead of dropping
  straight in.
- **Search window**: a search only looks within 4 cells of the rectangle
  around the connection's ends, and is widened only if that fails.
- **Budget**: after 10 000 expanded states a connection is searched again
  ignoring all other lines. Such connections are typically walled in by
  other lines; without them the search is quick, and the lanes still keep
  the lines apart.
- **Fallback**: if an IED is walled in completely, the fixed Z or L shape
  from `routePoints` is drawn.
- **Large diagrams**: above 150 connections there is one pass and a
  budget of 3 000.

## 2. Order

Lines sharing a path must each keep to one side of the others, or they
cross where the path bends or ends. For every pair of lines sharing a
stretch of lattice edges, `orderRoutes` looks at where the two lines join
the stretch and where they leave it:

- A line that joins from the left of the direction of travel, and leaves to
  the left, runs left of the other along the whole stretch, also around its
  bends. Seen in the other line's direction it runs right; both agree.
- When one joins from one side and leaves to the other, one crossing is
  unavoidable; the side is chosen by where they leave.
- Lines that join and leave alike (both ending at the same IED face, say)
  get a fixed order.

The result is, per lattice edge, which of two lines runs on the side of
larger coordinates.

## 3. Nudge

`nudgeRoutes` groups the segments of all lines by the lattice line they run
on, merges overlapping segments of a line, and gives every set of
overlapping segments its own lane:

- **Lane order** follows stage 2: a line that must run below another gets a
  higher lane. Lanes are assigned as a longest path through the "runs
  below" relation, so overlapping segments always get different lanes.
- **Lane positions** are spread up to 0.16 cells apart, centred on the
  original street, within the room the channel offers: they keep 0.1 cells
  from symbols, and share the room with lanes on parallel streets nearby.
  Where symbols leave no room, lanes are squeezed to 0.08 cells apart rather
  than drawn on top of each other.
- **Corners** move to where their two shifted segments meet, and lines
  end where their shifted last segment meets the IED face, so the attachment
  points of several lines spread along the face.

## Drawing and interaction

Corners are rounded (radius 0.15 cells, less on short segments) and an
arrowhead marks the receiving end. Each line has a background coloured
casing, so where lines cross the one on top visibly interrupts the one
below.

Lines drawn close together can still be hard to hit with the pointer, so
the overlay picks lines by distance (6 px): the nearest line is
highlighted, and a click near several lines opens a menu listing them.

## Responsiveness

Searching takes about 0.15 s for the 48 connections of a real protection
scheme, too long to run on every click. The plugin therefore:

1. draws a **quick preview** at once (`quickRoute`, a few milliseconds):
   fixed shapes between faces chosen from the IEDs' positions, nudged apart;
2. searches in the background in slices of 12 ms
   (`routeConnectionsAsync`), showing "Optimising connection routes…", and
   replaces the preview when done; a new filter cancels the search;
3. keeps the last 16 results, so going back to an earlier filter or IED
   selection is instant.

## How the approach was chosen

Several approaches were implemented and measured on a real 12 MB SCD file
(48 connections between 16 placed IEDs, Siemens and SEL), on the generated
demo file and on generated stress files. The measures, in
`src/testing/routing-metrics.ts`, count crossings, lines drawn on top of each other
(overlap), lines closer than 0.1 cells (crowded) and length drawn through
symbols (intrusion) or labels.

| Approach | Crossings | Overlap | Crowded | Through symbols | Through labels |
| --- | --- | --- | --- | --- | --- |
| Fixed Z/L shapes (the previous editor) | 142 | 421 | 9.5 | 15.8 | 31.1 |
| Fixed shapes, nudged into lanes | 214 | 2.1 | 108 | 17.1 | 34.2 |
| A* search with congestion, nudged | 200 | 0 | 140 | 7.6 | 3.5 |
| **A* with channels, order and nudge (current)** | **97** | **0** | **32** | **0** | 6.5 |

On the generated demo file, crossings dropped from 134 (A* with congestion)
to 16. Ideas that were tried and not kept:

- **One line per IED pair** (all connections between two IEDs drawn as one
  line): far less ink, but connections could no longer be picked
  individually.
- **Shared trunks per control block** (multicast trees): more bends and
  crowding for little saving, as most control blocks have one or two
  subscribers.
- **A heavier weighted search** (weight 2–3): five times faster, but up to
  twice the bends.
- **Charging crossings only where lines pass straight through each other**:
  more lines joined at corners and then had to cross when they left; more
  crossings overall.

## Limits and ideas

- Most remaining crossings are forced by where IEDs are placed. Moving IEDs,
  or suggesting placements, would help most.
- An IED receiving very many connections (a busbar protection with over a
  hundred) makes the search slow and the lines around it dense. Merging the
  lines entering such a hub into a trunk would help.
- Ports are face midpoints; letting lines attach anywhere along a face
  before the search would give the search more freedom.

## Tuning

`routingSettings` in `connection-routing.ts` holds all values. The specs
check the main properties (no overlap, no symbol intrusion, crossings no
worse than the quick preview, exact time-sliced results); after changing a
value, compare `measureRoutes` on a few real files, as the table above does.
