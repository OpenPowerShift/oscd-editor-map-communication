import { css, html, LitElement, nothing, PropertyValues, TemplateResult } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { msg, str } from '@lit/localize';
import { newEditEventV2 } from '@openscd/oscd-api/utils.js';
import { ScopedElementsMixin } from '@open-wc/scoped-elements/lit-element.js';

import { oscdMd3Mappings } from '@omicronenergy/oscd-ui/oscd-md3-mappings.js';
import { SldSubstationViewer } from '@omicronenergy/oscd-editor-sld/sld-substation-viewer.js';
import {
  attributes,
  sldNs,
  type Style,
} from '@omicronenergy/oscd-editor-sld/foundations.js';
import { identity } from '@openscd/scl-lib';

import MapConnectionLayer, {
  type ConnectionSelectEvent,
  type ConnectionShape,
  type IedSelectEvent,
  type PlacedIed,
} from './components/map-connection-layer.js';
import MapToolbar, {
  maxGridSize,
  minGridSize,
  zoomFactor,
  zoomGridSize,
  type FilterChangeEvent,
  type MapView,
  type ViewChangeEvent,
} from './components/map-toolbar.js';
import MapFilterPanel from './components/map-filter-panel.js';
import MapConnectionDialog, {
  type RemoveInputsEvent,
} from './components/map-connection-dialog.js';
import { buildConnections, iedReferenceMap } from './foundation/connections.js';
import {
  activeCriteria,
  emptyFilter,
  emptyOptions,
  filterConnections,
  filterOptions,
  scopeFilter,
  toggleService,
  type ConnectionFilter,
  type FilterOptions,
} from './foundation/filter.js';
import { fadeRules } from './foundation/diagram-style.js';
import { readStored, writeStored } from './foundation/storage.js';
import type { SearchableIed } from './foundation/ied-search.js';
import { shortcutAction, type ShortcutAction } from './foundation/shortcuts.js';
import type { IedLocateEvent } from './components/map-ied-search.js';
import {
  composeSvg,
  exportFileName,
  saveFile,
  svgToPdf,
  svgToPng,
  visibleBox,
  type ExportFormat,
  type ExportScope,
  type ViewBox,
} from './foundation/export.js';
import { removeInputsEdits } from './foundation/edits.js';
import { connectionTitle, connectionTooltip } from './foundation/inputs.js';
import { hasLegacySldLayout } from './foundation/legacy.js';
import { linkedEquipment } from './foundation/linked-equipment.js';
import {
  quickRoute,
  routeConnectionsAsync,
  type RoutingContext,
} from './foundation/connection-routing.js';
import type {
  Obstacle,
  Point,
  RoutedConnection,
  RouteInput,
} from './foundation/routing.js';
import { services, type Connection, type Service } from './foundation/types.js';
import { themeStyles } from './theme.js';

/** Everything drawn for one substation. */
interface SubstationLayout {
  substation: Element;
  dimensions: Point;
  ieds: PlacedIed[];
  shapes: ConnectionShape[];
  highlight: { id: string; style: Style }[];
  /** Identifies the routing problem, for caching its result. */
  key: string;
  /** Set while `shapes` is the quick preview of the routes being searched. */
  pending?: { inputs: RouteInput[]; context: RoutingContext; drawn: Connection[] };
}

/** Routing results kept for quick switching between filters. */
const cacheSize = 16;

const storageKey = 'oscd-editor-map-communication';

/** Pointer travel (px) after which a press becomes a pan instead of a click. */
const panThreshold = 4;

/** Smallest grid size (px) an IED is shown at when located. */
const locateGridSize = 32;

/** How long a located IED pulses (ms). */
const flashDuration = 2400;

/** Free space kept around the diagram when fitting it into view (px). */
const fitMargin = 24;

interface StoredSettings {
  services?: Service[];
  showLabels?: boolean;
  filterOpen?: boolean;
  gridSize?: number;
}

function loadSettings(): StoredSettings {
  try {
    const stored = JSON.parse(readStored(storageKey) ?? '{}');
    return typeof stored === 'object' && stored !== null ? stored : {};
  } catch {
    // Not JSON: start afresh.
    return {};
  }
}

function saveSettings(settings: StoredSettings): void {
  writeStored(storageKey, JSON.stringify(settings));
}

/** References of IEDs that exist in the document, by IED name. */
function placedIeds(doc: XMLDocument): Map<string, Element> {
  const names = new Set(
    Array.from(doc.querySelectorAll(':root > IED'), ied =>
      ied.getAttribute('name'),
    ),
  );
  return new Map(
    Array.from(iedReferenceMap(doc)).filter(([name]) => names.has(name)),
  );
}

/** Approximate box of an SLD label (text left-aligned, vertically centred). */
function labelRect(
  [lx, ly]: Point,
  text: string,
  fontSize: number,
): Obstacle['rect'] {
  const width = text.length * fontSize * 0.55;
  return [lx + 0.1, ly - 0.5 - fontSize / 2, width, fontSize];
}

/**
 * Things drawn on a substation diagram that connections should avoid: IED
 * and equipment symbols, and their labels and those of bays and voltage
 * levels.
 */
function diagramObstacles(
  substation: Element,
  placed: Map<string, Point>,
  references: Map<string, Element> = new Map(),
): Obstacle[] {
  const obstacles: Obstacle[] = [];
  placed.forEach(([x, y], ied) => {
    obstacles.push({ ied, rect: [x, y, 1, 1] });
    const reference = references.get(ied);
    if (reference) {
      obstacles.push({
        ied,
        kind: 'label',
        rect: labelRect(attributes(reference).label, ied, 0.6),
      });
    }
  });
  substation
    .querySelectorAll('ConductingEquipment, PowerTransformer')
    .forEach((equipment) => {
      const {
        pos: [x, y],
        dim: [w, h],
        label,
      } = attributes(equipment);
      obstacles.push({ rect: [x, y, Math.max(1, w), Math.max(1, h)] });
      obstacles.push({
        kind: 'label',
        rect: labelRect(label, equipment.getAttribute('name') ?? '', 0.45),
      });
    });
  Array.from(substation.getElementsByTagNameNS(sldNs, 'Section')).forEach(
    (section) => {
      const vertices = Array.from(
        section.getElementsByTagNameNS(sldNs, 'Vertex'),
      ).map(vertex => [
        Number(vertex.getAttributeNS(sldNs, 'x')),
        Number(vertex.getAttributeNS(sldNs, 'y')),
      ]);
      for (let v = 1; v < vertices.length; v += 1) {
        const [x1, y1] = vertices[v - 1];
        const [x2, y2] = vertices[v];
        if (x1 === x2 || y1 === y2) {
          obstacles.push({
            kind: 'wire',
            rect: [
              Math.min(x1, x2),
              Math.min(y1, y2),
              Math.abs(x2 - x1),
              Math.abs(y2 - y1),
            ],
          });
        }
      }
    },
  );
  substation.querySelectorAll('VoltageLevel, Bay').forEach((container) => {
    const {
      pos: [x, y],
      dim: [w, h],
    } = attributes(container);
    if (w > 0 && h > 0) {
      obstacles.push({ kind: 'border', rect: [x, y, w, h] });
    }
    obstacles.push({
      kind: 'label',
      rect: labelRect(
        attributes(container).label,
        container.getAttribute('name') ?? '',
        0.6,
      ),
    });
  });
  return obstacles;
}

const highlightStyle: Style = {
  fill: 'var(--oscd-map-highlight-color)',
  fillOpacity: 0.35,
};

/** An editor plugin mapping IEC 61850 communication onto the single line diagram. */
export default class OscdEditorMapCommunication extends ScopedElementsMixin(
  LitElement,
) {
  static scopedElements = {
    'sld-substation-viewer': SldSubstationViewer,
    'map-connection-layer': MapConnectionLayer,
    'map-toolbar': MapToolbar,
    'map-filter-panel': MapFilterPanel,
    'map-connection-dialog': MapConnectionDialog,
  };

  @property({ attribute: false })
  doc?: XMLDocument;

  @property({ attribute: false })
  docVersion: unknown = -1;

  @property({ type: String })
  locale = 'en';

  /** Name of the open document, used to name exported images. */
  @property({ type: String })
  docName?: string;

  /** Hands an exported file to the user; replaceable for tests. */
  saveExport: (blob: Blob, name: string) => void = saveFile;

  @state()
  filter: ConnectionFilter = emptyFilter();

  @state()
  view: MapView = { gridSize: 32, showLabels: true, filterOpen: false };

  @state()
  selectedConnection?: string;

  @query('main')
  private viewport?: HTMLElement;

  /** Whether the map is shown full screen. */
  @state()
  fullscreen = false;

  /** IED pulsing after it was located with the search. */
  @state()
  flashIed?: string;

  private flashTimer?: ReturnType<typeof setTimeout>;

  /** IEDs placed on the document's diagrams, for the search. */
  private searchable: SearchableIed[] = [];

  /** True while a slow router works in the background. */
  @state()
  routing = false;

  /** Settles when the background routing started last has finished. */
  routingDone: Promise<void> = Promise.resolve();

  private routingJob?: AbortController;

  /** Key of the layout the routing job works on. */
  private routingKey?: string;

  /** Routed connections by layout key, most recent last. */
  private routeCache = new Map<string, RoutedConnection[]>();

  /** Counts document changes, so cached routes of older versions expire. */
  private generation = 0;

  /** All connections of the document, rebuilt when the document changes. */
  connections: Connection[] = [];

  /** Connections shown with the current filter. */
  visibleConnections: Connection[] = [];

  private connectionsById = new Map<string, Connection>();


  /** IED names to the references placing them, for IEDs in the document. */
  private references = new Map<string, Element>();

  private legacyLayout = false;

  /** The document's substations. */
  private substations: Element[] = [];

  /** Layout of the substation shown. */
  private layout?: SubstationLayout;

  /** Fit the diagram into view after the next render (new document). */
  private fitPending = false;

  /** Pointer press that may become a pan. */
  /**
   * True while the diagram is fitted into view: it is fitted again when the
   * view changes size (toolbar wrapping, full screen, window resizing) until
   * the user zooms or pans.
   */
  private fitted = false;

  private resizeObserver = new ResizeObserver(() => {
    if (this.fitted) {
      this.zoomToFit();
    }
  });

  private observed?: Element;

  private pan?: {
    pointer: number;
    x: number;
    y: number;
    left: number;
    top: number;
    moved: boolean;
  };

  /** Ids of the visible connections drawn on a diagram. */
  private drawn = new Set<string>();

  private options: FilterOptions = emptyOptions();

  constructor() {
    super();
    const settings = loadSettings();
    if (Array.isArray(settings.services)) {
      this.filter = {
        ...this.filter,
        services: services.filter(s => settings.services!.includes(s)),
      };
    }
    this.view = {
      gridSize:
        typeof settings.gridSize === 'number' &&
        settings.gridSize >= minGridSize &&
        settings.gridSize <= maxGridSize
          ? settings.gridSize
          : this.view.gridSize,
      showLabels: settings.showLabels ?? this.view.showLabels,
      filterOpen: settings.filterOpen ?? this.view.filterOpen,
    };
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // On the document, so shortcuts also work before the map was clicked,
    // when the page itself has focus (see handleKeydown).
    document.addEventListener('keydown', this.handleKeydown);
    document.addEventListener('fullscreenchange', this.handleFullscreenChange);
  }

  /**
   * Whether this element is the one shown full screen. Inside a shadow root
   * (as in the OpenSCD shell) `document.fullscreenElement` is the outermost
   * host, so the element's own root is asked.
   */
  private isFullscreen(): boolean {
    const root = this.getRootNode() as Document | ShadowRoot;
    return root.fullscreenElement === this;
  }

  private handleFullscreenChange = (): void => {
    this.fullscreen = this.isFullscreen();
  };

  /** Shows the map full screen, or leaves full screen. */
  async toggleFullscreen(): Promise<void> {
    try {
      if (this.isFullscreen()) {
        await document.exitFullscreen();
      } else {
        await this.requestFullscreen();
      }
    } catch {
      // Full screen may be refused (no user gesture, or disallowed by the
      // embedding page): the map just stays as it is.
    }
  }

  /**
   * Shows an IED: switches to its substation, zooms in if the diagram is
   * shown small, centres the IED and makes it pulse for a moment.
   */
  async locateIed({ name, substation }: SearchableIed): Promise<void> {
    if (this.shownSubstation()?.getAttribute('name') !== substation) {
      this.view = { ...this.view, substation };
      await this.updateComplete;
    }
    const placed = this.layout?.ieds.find(ied => ied.name === name);
    const viewport = this.viewport;
    if (!placed || !viewport) {
      return;
    }
    this.fitted = false;
    if (this.view.gridSize < locateGridSize) {
      this.view = { ...this.view, gridSize: locateGridSize };
      this.persist();
    }
    // Restart the pulse when the same IED is located again.
    this.flashIed = undefined;
    await this.updateComplete;
    const canvas = viewport.querySelector('.canvas')!.getBoundingClientRect();
    const bounds = viewport.getBoundingClientRect();
    const { gridSize } = this.view;
    const [x, y] = placed.position;
    viewport.scrollBy({
      left: canvas.left + (x + 0.5) * gridSize - (bounds.left + bounds.width / 2),
      top: canvas.top + (y + 0.5) * gridSize - (bounds.top + bounds.height / 2),
      behavior: 'smooth',
    });
    this.flashIed = name;
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.flashIed = undefined;
    }, flashDuration);
  }

  override disconnectedCallback(): void {
    document.removeEventListener('keydown', this.handleKeydown);
    document.removeEventListener(
      'fullscreenchange',
      this.handleFullscreenChange,
    );
    clearTimeout(this.flashTimer);
    this.routingJob?.abort();
    this.routingJob = undefined;
    this.resizeObserver.disconnect();
    this.observed = undefined;
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    const docChanged = changed.has('doc') || changed.has('docVersion');
    if (docChanged) {
      this.generation += 1;
      this.routeCache.clear();
      this.connections = this.doc ? buildConnections(this.doc) : [];
      this.references = this.doc ? placedIeds(this.doc) : new Map();
      this.legacyLayout = this.doc ? hasLegacySldLayout(this.doc) : false;
      this.connectionsById = new Map(this.connections.map(c => [c.id, c]));
      this.substations = this.doc
        ? Array.from(this.doc.querySelectorAll(':root > Substation'))
        : [];
      this.searchable = Array.from(this.references, ([name, reference]) => ({
        name,
        substation: reference.closest('Substation')?.getAttribute('name') ?? '',
        desc:
          this.doc
            ?.querySelector(`:root > IED[name="${CSS.escape(name)}"]`)
            ?.getAttribute('desc') ?? undefined,
      }));
      if (
        this.selectedConnection !== undefined &&
        !this.connectionsById.has(this.selectedConnection)
      ) {
        this.selectedConnection = undefined;
      }
    }
    if (changed.has('doc')) {
      this.fitPending = this.doc !== undefined;
      if (this.filter.ied !== undefined) {
        this.filter = { ...this.filter, ied: undefined };
      }
    }
    const substationChanged =
      changed.has('view') &&
      changed.get('view')?.substation !== this.view.substation;
    if (
      docChanged ||
      substationChanged ||
      changed.has('filter')
    ) {
      this.visibleConnections = filterConnections(this.connections, this.filter);
      this.options = filterOptions(
        filterConnections(this.connections, scopeFilter(this.filter)),
        this.filter,
      );
      const substation = this.shownSubstation();
      this.layout = substation ? this.computeLayout(substation) : undefined;
      this.drawn = new Set(this.layout?.shapes.map(({ id }) => id));
    }
  }

  /** Fades the SLD viewer's diagram, keeping IEDs and highlights clear. */
  private fadeSheet = new CSSStyleSheet();

  private fadeText = '';

  private fadeDiagram(): void {
    const root = this.renderRoot.querySelector('sld-substation-viewer')
      ?.shadowRoot;
    if (!root || !this.layout) {
      return;
    }
    const text = fadeRules(
      this.layout.ieds.map(({ name }) => name),
      this.layout.highlight.map(({ id }) => id),
    );
    if (text !== this.fadeText) {
      this.fadeText = text;
      this.fadeSheet.replaceSync(text);
    }
    if (!root.adoptedStyleSheets.includes(this.fadeSheet)) {
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, this.fadeSheet];
    }
  }

  protected override updated(): void {
    this.fadeDiagram();
    if (this.viewport !== this.observed) {
      if (this.observed) {
        this.resizeObserver.unobserve(this.observed);
      }
      this.observed = this.viewport;
      if (this.observed) {
        this.resizeObserver.observe(this.observed);
      }
    }
    if (this.fitPending && this.viewport && this.layout) {
      this.fitPending = false;
      this.zoomToFit();
    }
    this.startRouting();
  }

  /**
   * Searches the routes of the shown layout in the background (see
   * `connection-routing.ts`), replacing its quick preview when done.
   */
  private startRouting(): void {
    const layout = this.layout;
    if (!layout?.pending) {
      if (this.routingJob) {
        this.routingJob.abort();
        this.routingJob = undefined;
        this.routing = false;
      }
      return;
    }
    if (this.routingJob && this.routingKey === layout.key) {
      return;
    }
    this.routingJob?.abort();
    const job = new AbortController();
    this.routingJob = job;
    this.routingKey = layout.key;
    this.routing = true;
    const { inputs, context, drawn } = layout.pending;
    this.routingDone = routeConnectionsAsync(inputs, context, {
      signal: job.signal,
    }).then((routed) => {
      if (!routed || job.signal.aborted) {
        return;
      }
      this.cacheRoutes(layout.key, routed);
      this.routingJob = undefined;
      this.routing = false;
      if (this.layout?.key === layout.key) {
        this.layout = {
          ...this.layout,
          shapes: this.toShapes(routed, drawn),
          pending: undefined,
        };
      }
    });
  }

  private cacheRoutes(key: string, routed: RoutedConnection[]): void {
    this.routeCache.delete(key);
    this.routeCache.set(key, routed);
    if (this.routeCache.size > cacheSize) {
      this.routeCache.delete(this.routeCache.keys().next().value!);
    }
  }

  private toShapes(
    routed: RoutedConnection[],
    drawn: Connection[],
  ): ConnectionShape[] {
    return routed.map((route, i) => ({ ...route, service: drawn[i].service }));
  }

  /** The substation selected in the view, or the first one. */
  private shownSubstation(): Element | undefined {
    return (
      this.substations.find(
        s => s.getAttribute('name') === this.view.substation,
      ) ?? this.substations[0]
    );
  }

  /**
   * Handles the map's keyboard shortcuts while the map is shown and either
   * has focus or nothing does (the page itself, e.g. right after opening a
   * file). Keys pressed elsewhere, such as in the shell's own fields, are
   * left alone.
   */
  private handleKeydown = (event: KeyboardEvent): void => {
    const path = event.composedPath();
    const origin = path[0];
    const unfocused =
      origin === document.body ||
      origin === document.documentElement ||
      origin === document;
    if (
      (!path.includes(this) && !unfocused) ||
      this.getClientRects().length === 0
    ) {
      return;
    }
    if (event.key === 'Escape' && this.filter.ied !== undefined) {
      this.filter = { ...this.filter, ied: undefined };
      return;
    }
    const action = shortcutAction(
      event,
      !!(origin as HTMLElement | undefined)?.closest?.(
        'input, textarea, select, [contenteditable]',
      ),
    );
    if (!action) {
      return;
    }
    // The map takes these keys over from the browser while it has focus.
    event.preventDefault();
    event.stopPropagation();
    this.runShortcut(action);
  };

  /** Performs a keyboard shortcut's action. */
  runShortcut(action: ShortcutAction): void {
    const service: Partial<Record<ShortcutAction, Service>> = {
      'toggle-goose': 'GOOSE',
      'toggle-sv': 'SV',
      'toggle-report': 'Report',
    };
    if (service[action]) {
      this.filter = {
        ...this.filter,
        services: toggleService(this.filter.services, service[action]!),
      };
      this.persist();
      return;
    }
    switch (action) {
      case 'search':
        this.renderRoot.querySelector<MapToolbar>('map-toolbar')?.focusSearch();
        break;
      case 'zoom-in':
        this.zoomAt(zoomFactor);
        break;
      case 'zoom-out':
        this.zoomAt(1 / zoomFactor);
        break;
      case 'zoom-fit':
        this.zoomToFit();
        break;
      case 'previous-substation':
      case 'next-substation':
        this.stepSubstation(action === 'next-substation' ? 1 : -1);
        break;
      case 'toggle-labels':
        this.view = { ...this.view, showLabels: !this.view.showLabels };
        this.persist();
        break;
      default:
        this.view = { ...this.view, filterOpen: !this.view.filterOpen };
        this.persist();
    }
  }

  /** Shows the next (1) or previous (-1) substation, wrapping around. */
  private stepSubstation(step: number): void {
    const count = this.substations.length;
    const shown = this.shownSubstation();
    if (count < 2 || !shown) {
      return;
    }
    const next =
      this.substations[(this.substations.indexOf(shown) + step + count) % count];
    this.view = { ...this.view, substation: next.getAttribute('name') ?? '' };
    this.fitPending = true;
  }

  private handleFilterChange(event: FilterChangeEvent): void {
    this.filter = { ...this.filter, ...event.detail };
    this.persist();
  }

  private handleViewChange(event: ViewChangeEvent): void {
    this.view = { ...this.view, ...event.detail };
    this.persist();
  }

  private handleIedSelect(event: IedSelectEvent): void {
    const { name } = event.detail;
    this.filter = {
      ...this.filter,
      ied: this.filter.ied === name ? undefined : name,
    };
  }

  private handleConnectionSelect(event: ConnectionSelectEvent): void {
    const { id } = event.detail;
    this.selectedConnection = id;
  }

  private handleConnectionClose(): void {
    this.selectedConnection = undefined;
  }

  private handleRemoveInputs(event: RemoveInputsEvent): void {
    const { inputs } = event.detail;
    const edits = removeInputsEdits(inputs);
    if (edits.length === 0) {
      return;
    }
    const connection = this.selectedConnection
      ? this.connectionsById.get(this.selectedConnection)
      : undefined;
    const title = connection
      ? msg(str`Remove ${inputs.length} input(s) of ${connectionTitle(connection)}`)
      : msg('Remove inputs');
    this.dispatchEvent(newEditEventV2(edits, { title }));
  }

  /**
   * Zooms by `factor`, keeping the diagram point under the client position
   * (default: the viewport's centre) in place.
   */
  async zoomAt(factor: number, clientX?: number, clientY?: number): Promise<void> {
    this.fitted = false;
    const viewport = this.viewport;
    const canvas = viewport?.querySelector('.canvas');
    const gridSize = zoomGridSize(this.view.gridSize, factor);
    if (!viewport || !canvas || gridSize === this.view.gridSize) {
      return;
    }
    const bounds = viewport.getBoundingClientRect();
    const x = clientX ?? bounds.left + bounds.width / 2;
    const y = clientY ?? bounds.top + bounds.height / 2;
    const before = canvas.getBoundingClientRect();
    const scale = gridSize / this.view.gridSize;
    this.view = { ...this.view, gridSize };
    this.persist();
    await this.updateComplete;
    const after = canvas.getBoundingClientRect();
    viewport.scrollLeft += after.left + (x - before.left) * scale - x;
    viewport.scrollTop += after.top + (y - before.top) * scale - y;
  }

  /** Zooms so the whole diagram fits the viewport. */
  zoomToFit(): void {
    const viewport = this.viewport;
    if (!viewport || !this.layout) {
      return;
    }
    const [w, h] = this.layout.dimensions;
    const fit = Math.min(
      (viewport.clientWidth - 2 * fitMargin) / Math.max(1, w),
      (viewport.clientHeight - 2 * fitMargin) / Math.max(1, h),
    );
    if (!Number.isFinite(fit) || fit <= 0) {
      return;
    }
    const gridSize = Math.min(
      maxGridSize,
      Math.max(minGridSize, Math.floor(fit * 10) / 10),
    );
    this.view = { ...this.view, gridSize };
    this.persist();
    viewport.scrollTo(0, 0);
    this.fitted = true;
  }

  /**
   * Exports the shown substation as drawn, connections included: the whole
   * diagram or the part visible in the viewport, as SVG or PNG.
   */
  async exportImage(scope: ExportScope, format: ExportFormat): Promise<void> {
    const { layout, viewport } = this;
    const sld = this.renderRoot
      .querySelector('sld-substation-viewer')
      ?.shadowRoot?.querySelector<SVGSVGElement>('svg#sld');
    const overlay = this.renderRoot
      .querySelector('map-connection-layer')
      ?.shadowRoot?.querySelector<SVGSVGElement>('svg');
    if (!layout || !viewport || !sld || !overlay) {
      return;
    }
    const { gridSize } = this.view;
    const [columns, rows] = layout.dimensions;
    const box: ViewBox =
      scope === 'view'
        ? visibleBox(
          viewport.getBoundingClientRect(),
          sld.getBoundingClientRect(),
          gridSize,
          layout.dimensions,
        )
        : [0, 0, columns, rows];
    const text = composeSvg(
      [sld, overlay],
      box,
      gridSize,
      getComputedStyle(this).backgroundColor,
    );
    const name = exportFileName(
      this.docName,
      layout.substation.getAttribute('name') ?? '',
      scope,
      format,
    );
    const [width, height] = [box[2] * gridSize, box[3] * gridSize];
    const converters: Record<ExportFormat, () => Promise<Blob>> = {
      svg: async () => new Blob([text], { type: 'image/svg+xml' }),
      png: () => svgToPng(text, width, height),
      pdf: () => svgToPdf(text, width, height),
    };
    const blob = await converters[format]();
    this.saveExport(blob, name);
  }

  private handleExport(
    event: CustomEvent<{ scope: ExportScope; format: ExportFormat }>,
  ): void {
    this.exportImage(event.detail.scope, event.detail.format);
  }

  private handleWheel(event: WheelEvent): void {
    event.preventDefault();
    // Lines (Firefox) and pages are scaled to pixels.
    const unit = [1, 16, 400][event.deltaMode] ?? 1;
    const delta = Math.max(-200, Math.min(200, event.deltaY * unit));
    if (delta === 0) {
      return;
    }
    this.zoomAt(Math.exp(-delta * 0.002), event.clientX, event.clientY);
  }

  private handlePointerDown(event: PointerEvent): void {
    // Left (primary) or middle (wheel) button press: may start a pan.
    if ((event.button !== 0 && event.button !== 1) || !this.viewport) {
      return;
    }
    if (event.button === 1) {
      // No auto-scroll cursor on middle click.
      event.preventDefault();
    }
    this.pan = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: this.viewport.scrollLeft,
      top: this.viewport.scrollTop,
      moved: false,
    };
  }

  private handlePointerMove(event: PointerEvent): void {
    const { pan, viewport } = this;
    if (!pan || !viewport || event.pointerId !== pan.pointer) {
      return;
    }
    const dx = event.clientX - pan.x;
    const dy = event.clientY - pan.y;
    if (!pan.moved && Math.hypot(dx, dy) < panThreshold) {
      return;
    }
    if (!pan.moved) {
      pan.moved = true;
      this.fitted = false;
      viewport.setPointerCapture?.(event.pointerId);
      viewport.classList.add('panning');
    }
    viewport.scrollLeft = pan.left - dx;
    viewport.scrollTop = pan.top - dy;
  }

  private handlePointerUp(event: PointerEvent): void {
    const { pan, viewport } = this;
    if (!pan || event.pointerId !== pan.pointer) {
      return;
    }
    this.pan = undefined;
    viewport?.classList.remove('panning');
    if (pan.moved) {
      // The press was a pan: swallow the click that may follow it.
      const swallow = (click: Event) => {
        click.stopPropagation();
        click.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, true), 0);
    }
  }

  private persist(): void {
    saveSettings({
      services: this.filter.services,
      showLabels: this.view.showLabels,
      filterOpen: this.view.filterOpen,
      gridSize: this.view.gridSize,
    });
  }

  private computeLayout(substation: Element): SubstationLayout {
    const placed = new Map<string, Point>();
    this.references.forEach((reference, name) => {
      if (reference.closest('Substation') === substation) {
        placed.set(name, attributes(reference).pos);
      }
    });

    const drawn = this.visibleConnections.filter(
      ({ source, target }) =>
        placed.has(source.name) && placed.has(target.name),
    );
    const dimensions = attributes(substation).dim;
    const inputs: RouteInput[] = drawn.map(
      ({ id, source, target }) => ({
        id,
        source: { key: source.name, position: placed.get(source.name)! },
        target: { key: target.name, position: placed.get(target.name)! },
      }),
    );
    const context: RoutingContext = {
      dimensions,
      obstacles: diagramObstacles(substation, placed, this.references),
    };
    const key = [
      this.generation,
      substation.getAttribute('name'),
      ...inputs.map(({ id }) => id),
    ].join('\u0000');
    const cached = this.routeCache.get(key);
    // Not routed yet: draw the quick preview and search in the background.
    const pending = !cached && inputs.length > 0;
    const routed = cached ?? quickRoute(inputs, context);

    const { ied } = this.filter;
    const highlight =
      ied === undefined
        ? []
        : linkedEquipment(substation, ied).map(equipment => ({
          id: `${identity(equipment)}`,
          style: highlightStyle,
        }));

    return {
      substation,
      dimensions,
      ieds: Array.from(placed, ([name, position]) => ({ name, position })),
      shapes: this.toShapes(routed, drawn),
      highlight,
      key,
      pending: pending ? { inputs, context, drawn } : undefined,
    };

  }

  private describeConnection = (id: string): string => {
    const connection = this.connectionsById.get(id);
    return connection ? connectionTooltip(connection) : '';
  };

  private labelConnection = (id: string): string => {
    const connection = this.connectionsById.get(id);
    return connection ? connectionTitle(connection) : id;
  };

  private renderEmpty(message: string): TemplateResult {
    return html`<p class="empty">${message}</p>`;
  }

  private renderNotice(): TemplateResult | typeof nothing {
    if (!this.layout || this.layout.ieds.length === 0) {
      return html`<p class="notice">
        ${msg(
          'No IEDs are placed on the diagram yet. Place them with the Single Line Diagram editor to see their communication.',
        )}
      </p>`;
    }
    if (this.connections.length === 0) {
      return html`<p class="notice">
        ${msg('No GOOSE, Sampled Value or Report connections found.')}
      </p>`;
    }
    return nothing;
  }

  private renderSubstation(layout: SubstationLayout): TemplateResult {
    const { substation, dimensions, ieds, shapes, highlight } = layout;
    return html`<section
      class="canvas"
      aria-label=${substation.getAttribute('name') ?? msg('Substation')}
    >
      <sld-substation-viewer
        .doc=${this.doc}
        .substation=${substation}
        .docVersion=${this.docVersion}
        .gridSize=${this.view.gridSize}
        .showLabels=${this.view.showLabels}
        .showIeds=${true}
        .highlight=${highlight}
      ></sld-substation-viewer>
      <map-connection-layer
        .dimensions=${dimensions}
        .gridSize=${this.view.gridSize}
        .ieds=${ieds}
        .connections=${shapes}
        .selectedIed=${this.filter.ied}
        .selectedConnection=${this.selectedConnection}
        .describe=${this.describeConnection}
        .label=${this.labelConnection}
        .flashIed=${this.flashIed}
      ></map-connection-layer>
    </section>`;
  }

  render(): TemplateResult {
    const { doc } = this;
    if (!doc) {
      return this.renderEmpty(msg('No document loaded'));
    }
    if (!this.layout) {
      return this.renderEmpty(msg('No substation found in this document'));
    }
    if (this.legacyLayout) {
      return this.renderEmpty(
        msg(
          'This file uses an outdated single line diagram format. Open it in the Single Line Diagram editor to convert it, then return here.',
        ),
      );
    }

    return html`<div
      class="map"
      @map-filter-change=${this.handleFilterChange}
      @map-view-change=${this.handleViewChange}
      @map-ied-select=${this.handleIedSelect}
      @map-connection-select=${this.handleConnectionSelect}
      @map-connection-close=${this.handleConnectionClose}
      @map-remove-inputs=${this.handleRemoveInputs}
    >
      <map-toolbar
        .filter=${this.filter}
        .view=${this.view}
        .filterCount=${activeCriteria(this.filter)}
        .substations=${this.substations.map(s => s.getAttribute('name') ?? '')}
        @map-zoom-fit=${() => this.zoomToFit()}
        @map-export=${this.handleExport}
        @map-fullscreen=${() => this.toggleFullscreen()}
        @map-ied-locate=${(event: IedLocateEvent) => this.locateIed(event.detail)}
        .ieds=${this.searchable}
        .fullscreen=${this.fullscreen}
      ></map-toolbar>
      <div class="body">
        <div class="stage">
          ${this.renderNotice()}
          ${this.routing
            ? html`<p class="routing" role="status">
                ${msg('Optimising connection routes…')}
              </p>`
            : nothing}
          <main
            tabindex="0"
            aria-label=${msg(
              'Diagram: drag to pan; wheel, + or - to zoom; 0 to fit; / to find an IED; F for the filter panel; L for labels',
            )}
            @wheel=${this.handleWheel}
            @pointerdown=${this.handlePointerDown}
            @pointermove=${this.handlePointerMove}
            @pointerup=${this.handlePointerUp}
            @pointercancel=${this.handlePointerUp}
          >
            ${this.renderSubstation(this.layout)}
          </main>
        </div>
        ${this.view.filterOpen
          ? html`<map-filter-panel
              .filter=${this.filter}
              .options=${this.options}
              .connections=${this.visibleConnections}
              .drawn=${this.drawn}
              .selectedConnection=${this.selectedConnection}
            ></map-filter-panel>`
          : nothing}
      </div>
      <map-connection-dialog
        .connection=${this.selectedConnection
          ? this.connectionsById.get(this.selectedConnection)
          : undefined}
      ></map-connection-dialog>
    </div>`;
  }

  static styles = [
    oscdMd3Mappings,
    themeStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        /* Hosts sizing editors by their content still get a usable map. */
        min-height: 480px;
        background: var(--oscd-base3);
      }

      .map {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }

      map-toolbar {
        flex: none;
        /* Keeps the search results above the map. */
        position: relative;
        z-index: 2;
        border-bottom: 1px solid var(--oscd-base2);
      }

      .body {
        flex: auto;
        display: flex;
        min-height: 0;
      }

      .stage {
        flex: auto;
        position: relative;
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      main {
        flex: auto;
        display: flex;
        overflow: auto;
        min-height: 0;
        padding: 24px;
        cursor: grab;
        /* Panned by dragging and zoomed by the wheel: no scrollbars. */
        scrollbar-width: none;
        touch-action: none;
        user-select: none;
      }

      main::-webkit-scrollbar {
        display: none;
      }

      main:focus {
        outline: none;
      }

      main:focus-visible {
        outline: 2px solid var(--oscd-primary);
        outline-offset: -2px;
      }

      main.panning {
        cursor: grabbing;
      }

      map-filter-panel {
        flex: none;
        width: 380px;
        border-left: 1px solid var(--oscd-base2);
      }

      .canvas {
        position: relative;
        flex: none;
        width: fit-content;
        height: fit-content;
        /* Centred while smaller than the viewport, scrollable when larger. */
        margin: auto;
      }

      map-connection-layer {
        position: absolute;
        top: 0;
        left: 0;
      }

      .notice {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 1;
        margin: 0;
        padding: 8px 16px;
        color: var(--oscd-base01);
        background: color-mix(in srgb, var(--oscd-base3) 85%, transparent);
        pointer-events: none;
      }

      .routing {
        position: absolute;
        right: 12px;
        bottom: 12px;
        z-index: 1;
        margin: 0;
        padding: 4px 12px;
        border-radius: 12px;
        background: var(--oscd-base2);
        color: var(--oscd-base01);
        font-size: 0.85em;
        pointer-events: none;
      }

      .empty {
        margin: 16px;
        color: var(--oscd-base01);
      }
    `,
  ];
}
