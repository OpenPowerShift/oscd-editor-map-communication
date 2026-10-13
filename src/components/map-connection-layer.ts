import { css, html, LitElement, nothing, svg, TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { msg, str } from '@lit/localize';
import { ScopedElementsMixin } from '@open-wc/scoped-elements/lit-element.js';

import { OscdMenu } from '@omicronenergy/oscd-ui/menu/OscdMenu.js';
import { OscdMenuItem } from '@omicronenergy/oscd-ui/menu/OscdMenuItem.js';

import { pickRoutes } from '../foundation/picking.js';
import type { Point } from '../foundation/routing.js';
import type { Service } from '../foundation/types.js';

/** A routed connection as drawn by the layer. */
export interface ConnectionShape {
  id: string;
  service: Service;
  path: string;
  arrow: string;
  /** Corner points of the route, used to pick lines near the pointer. */
  points: Point[];
}

/** An IED placed on the diagram. */
export interface PlacedIed {
  name: string;
  position: Point;
}

export type IedSelectEvent = CustomEvent<{ name: string }>;
export type ConnectionSelectEvent = CustomEvent<{ id: string }>;

const serviceClass: Record<Service, string> = {
  GOOSE: 'goose',
  SV: 'sv',
  Report: 'report',
};

/** Space (px) between an IED symbol and its selection box. */
const iedPadding = 2.5;

/** How close (px) the pointer must be to a line to pick it. */
const pickTolerance = 6;

/** Connections offered when a click hits several lines. */
interface Choices {
  /** Position in px within the layer. */
  x: number;
  y: number;
  /** Connection ids, nearest line first. */
  ids: string[];
}

/**
 * SVG overlay drawn on top of an `sld-substation-viewer`, sharing its
 * coordinate system: one user unit per grid cell, `gridSize` pixels each.
 *
 * Draws the routed connections and a focusable hit target for every placed
 * IED. Only connection lines and IED targets take pointer events, so the
 * diagram underneath stays visible.
 *
 * Lines are picked by distance: the line nearest the pointer is drawn
 * thicker in the highlight colour, and a click hitting several lines drawn
 * close together opens a menu listing them.
 *
 * @fires map-ied-select - an IED was activated (click, Enter or Space)
 * @fires map-connection-select - a connection was picked
 */
export default class MapConnectionLayer extends ScopedElementsMixin(
  LitElement,
) {
  static scopedElements = {
    'oscd-menu': OscdMenu,
    'oscd-menu-item': OscdMenuItem,
  };

  /** Diagram size in grid cells. */
  @property({ attribute: false })
  dimensions: Point = [0, 0];

  @property({ type: Number })
  gridSize = 32;

  @property({ attribute: false })
  connections: ConnectionShape[] = [];

  @property({ attribute: false })
  ieds: PlacedIed[] = [];

  @property({ attribute: false })
  selectedIed?: string;

  @property({ attribute: false })
  selectedConnection?: string;

  /** IED drawing attention to itself, after it was searched for. */
  @property({ attribute: false })
  flashIed?: string;

  /** Describes a connection for its tooltip; called lazily on hover. */
  @property({ attribute: false })
  describe?: (id: string) => string;

  /** Time (ms) a line stays highlighted after the pointer left it. */
  @property({ type: Number })
  hoverDelay = 250;

  /** Short name of a connection, listed in the chooser. */
  @property({ attribute: false })
  label?: (id: string) => string;

  /** Id of the shape nearest the pointer. */
  @state()
  private hovered?: string;

  @state()
  private choices?: Choices;

  /** Connection previewed from the chooser. */
  @state()
  private preview?: string;

  private serviceOf(id: string): Service {
    return this.connections.find(shape => shape.id === id)?.service ?? 'GOOSE';
  }

  private handleIedKeydown(event: KeyboardEvent, name: string): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.selectIed(name);
    }
  }

  private selectIed(name: string): void {
    this.dispatchEvent(
      new CustomEvent('map-ied-select', {
        detail: { name },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private selectConnection(id: string): void {
    this.choices = undefined;
    this.preview = undefined;
    this.dispatchEvent(
      new CustomEvent('map-connection-select', {
        detail: { id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Pointer position in grid units and in px within the layer. */
  private locate(event: MouseEvent): { at: Point; px: Point } {
    const bounds = this.renderRoot.querySelector('svg')!.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    return { at: [x / this.gridSize, y / this.gridSize], px: [x, y] };
  }

  /** Shapes within reach of the pointer, nearest first. */
  private pick(event: MouseEvent): { ids: string[]; px: Point } {
    const { at, px } = this.locate(event);
    return {
      ids: pickRoutes(this.connections, at, pickTolerance / this.gridSize),
      px,
    };
  }

  private unhoverTimer?: ReturnType<typeof setTimeout>;

  /**
   * Highlights a line at once; un-highlights only after `hoverDelay`, so
   * moving the pointer across the gaps between lines does not make the
   * other lines flash back in.
   */
  private hover(id: string | undefined): void {
    clearTimeout(this.unhoverTimer);
    this.unhoverTimer = undefined;
    if (id !== undefined || this.hoverDelay <= 0) {
      this.hovered = id;
      return;
    }
    this.unhoverTimer = setTimeout(() => {
      this.unhoverTimer = undefined;
      this.hovered = undefined;
    }, this.hoverDelay);
  }

  override disconnectedCallback(): void {
    clearTimeout(this.unhoverTimer);
    super.disconnectedCallback();
  }

  private handlePointerMove(event: PointerEvent): void {
    const line = (event.target as Element).closest?.('.connection');
    if (!line) {
      this.hover(undefined);
      return;
    }
    const [nearest] = this.pick(event).ids;
    this.hover(nearest ?? line.getAttribute('data-id') ?? undefined);
  }

  private handleClick(event: MouseEvent): void {
    if (!(event.target as Element).closest?.('.connection')) {
      return;
    }
    const { ids, px } = this.pick(event);
    const fallback = (event.target as Element)
      .closest('.connection')!
      .getAttribute('data-id')!;
    const connections = ids.length > 0 ? ids : [fallback];
    if (connections.length === 1) {
      this.selectConnection(connections[0]);
      return;
    }
    this.choices = { x: px[0], y: px[1], ids: connections };
  }

  private closeChoices(): void {
    this.choices = undefined;
    this.preview = undefined;
  }

  private handleEscape(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.choices) {
      event.stopPropagation();
      this.closeChoices();
    }
  }

  /** A connection was picked in the chooser, by click or keyboard. */
  private handleChoice(event: CustomEvent<{ initiator: HTMLElement }>): void {
    const id = event.detail.initiator?.dataset.id;
    if (id) {
      this.selectConnection(id);
    }
  }

  private renderConnection(connection: ConnectionShape) {
    const { id, service, path, arrow } = connection;
    const hovered = this.hovered === id && !this.choices;
    const title =
      hovered && this.describe
        ? svg`<title>${this.describe(id)}</title>`
        : nothing;
    const previewed = this.preview === id;
    return svg`<g
      class=${classMap({
        connection: true,
        [serviceClass[service]]: true,
        hovered,
        selected: this.selectedConnection === id,
        previewed,
      })}
      data-id=${id}
    >
      ${title}
      <path class="hit" d=${path} />
      <path class="casing" d=${path} />
      <path class="line" d=${path} />
      <path class="arrow" d=${arrow} />
    </g>`;
  }

  private renderIed({ name, position: [x, y] }: PlacedIed) {
    const selected = this.selectedIed === name;
    // A little room around the symbol, the same on screen at any zoom.
    const pad = iedPadding / this.gridSize;
    return svg`<rect
      class=${classMap({ ied: true, selected, flash: this.flashIed === name })}
      data-name=${name}
      x=${x - pad}
      y=${y - pad}
      width=${1 + 2 * pad}
      height=${1 + 2 * pad}
      rx=${0.1 + pad}
      tabindex="0"
      role="button"
      aria-label=${msg(str`IED ${name}`)}
      aria-pressed=${selected ? 'true' : 'false'}
      @click=${() => this.selectIed(name)}
      @keydown=${(event: KeyboardEvent) => this.handleIedKeydown(event, name)}
    />`;
  }

  private renderChooser(): TemplateResult | typeof nothing {
    const { choices } = this;
    if (!choices) {
      return nothing;
    }
    return html`<span
        id="chooser-anchor"
        style="left: ${choices.x}px; top: ${choices.y}px"
      ></span>
      <oscd-menu
        class="chooser"
        anchor="chooser-anchor"
        positioning="popover"
        default-focus="first-item"
        skip-restore-focus
        aria-label=${msg('Connections here')}
        .open=${true}
        @close-menu=${this.handleChoice}
        @closed=${this.closeChoices}
      >
        <div class="chooser-title">
          ${msg(str`${choices.ids.length} connections here`)}
        </div>
        ${choices.ids.map(
          id => html`<oscd-menu-item
            class="choice ${serviceClass[this.serviceOf(id)]}"
            data-id=${id}
            @pointerenter=${() => {
              this.preview = id;
            }}
            @focusin=${() => {
              this.preview = id;
            }}
          >
            <span slot="start" class="swatch"></span>
            <div slot="headline">${this.label?.(id) ?? id}</div>
          </oscd-menu-item>`,
        )}
      </oscd-menu>`;
  }

  render(): TemplateResult {
    const [w, h] = this.dimensions;
    return html`<svg
        viewBox="0 0 ${w} ${h}"
        width=${w * this.gridSize}
        height=${h * this.gridSize}
        fill="none"
        @pointermove=${this.handlePointerMove}
        @pointerleave=${() => this.hover(undefined)}
        @click=${this.handleClick}
        @keydown=${this.handleEscape}
      >
        ${this.ieds.map(ied => this.renderIed(ied))}
        ${this.connections.map(connection => this.renderConnection(connection))}
      </svg>
      ${this.renderChooser()}`;
  }

  static styles = css`
    :host {
      display: block;
      pointer-events: none;
    }

    svg {
      display: block;
    }

    .ied {
      fill: transparent;
      pointer-events: all;
      cursor: pointer;
      outline: none;
    }

    .ied:focus-visible {
      stroke: var(--oscd-primary);
      stroke-width: 0.06;
    }

    .ied.selected {
      fill: var(--oscd-map-highlight-color);
      fill-opacity: 0.25;
      stroke: var(--oscd-map-highlight-color);
      stroke-width: 0.08;
    }

    /* A located IED pulses a few times. */
    .ied.flash {
      stroke: var(--oscd-map-highlight-color);
      animation: pulse 0.8s ease-in-out 3;
    }

    @keyframes pulse {
      0%,
      100% {
        stroke-width: 0.04;
        stroke-opacity: 0.3;
      }
      50% {
        stroke-width: 0.25;
        stroke-opacity: 1;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .ied.flash {
        animation: none;
        stroke-width: 0.12;
      }
    }

    .connection {
      cursor: pointer;
    }

    .goose {
      --oscd-map-connection-color: var(--oscd-map-goose-color);
    }

    .sv {
      --oscd-map-connection-color: var(--oscd-map-sv-color);
    }

    .report {
      --oscd-map-connection-color: var(--oscd-map-report-color);
    }

    .hit {
      stroke: transparent;
      stroke-width: 0.3;
      pointer-events: stroke;
    }

    /*
     * A background coloured band under each line: where lines cross, the
     * line drawn later interrupts the earlier one, so both stay readable.
     */
    .casing {
      stroke: var(--oscd-base3);
      stroke-width: 0.14;
      stroke-opacity: 0.9;
      pointer-events: none;
    }

    .line {
      stroke: var(--oscd-map-connection-color);
      stroke-width: 0.06;
      pointer-events: none;
    }

    .arrow {
      fill: var(--oscd-map-connection-color);
      stroke: var(--oscd-map-connection-color);
      stroke-width: 0.04;
      pointer-events: none;
    }

    .connection.hovered .line,
    .connection.selected .line,
    .connection.previewed .line {
      stroke: var(--oscd-map-highlight-color);
      stroke-width: 0.14;
    }

    .connection.hovered .arrow,
    .connection.selected .arrow,
    .connection.previewed .arrow {
      fill: var(--oscd-map-highlight-color);
      stroke: var(--oscd-map-highlight-color);
    }

    #chooser-anchor {
      position: absolute;
      width: 1px;
      height: 1px;
      pointer-events: none;
    }

    .chooser-title {
      padding: 6px 16px;
      color: var(--oscd-base01);
      font-size: 0.85em;
    }

    .swatch {
      flex: none;
      width: 16px;
      height: 4px;
      border-radius: 2px;
      background: var(--oscd-map-connection-color);
    }
  `;
}
