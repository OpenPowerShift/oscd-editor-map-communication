import { css, html, LitElement, nothing, TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { msg, str } from '@lit/localize';
import { ScopedElementsMixin } from '@open-wc/scoped-elements/lit-element.js';

import { OscdChipSet } from '@omicronenergy/oscd-ui/chips/OscdChipSet.js';
import { OscdFilterChip } from '@omicronenergy/oscd-ui/chips/OscdFilterChip.js';
import { OscdInputChip } from '@omicronenergy/oscd-ui/chips/OscdInputChip.js';
import { OscdIcon } from '@omicronenergy/oscd-ui/icon/OscdIcon.js';
import { OscdIconButton } from '@omicronenergy/oscd-ui/iconbutton/OscdIconButton.js';
import { OscdMenu } from '@omicronenergy/oscd-ui/menu/OscdMenu.js';
import { OscdMenuItem } from '@omicronenergy/oscd-ui/menu/OscdMenuItem.js';
import { OscdDivider } from '@omicronenergy/oscd-ui/divider/OscdDivider.js';
import { OscdOutlinedSelect } from '@omicronenergy/oscd-ui/select/OscdOutlinedSelect.js';
import { OscdSelectOption } from '@omicronenergy/oscd-ui/select/OscdSelectOption.js';

import { services, type Service } from '../foundation/types.js';
import type { ExportFormat, ExportScope } from '../foundation/export.js';
import type { SearchableIed } from '../foundation/ied-search.js';
import { shortcut } from '../foundation/shortcuts.js';
import MapIedSearch from './map-ied-search.js';
import { toggleService, type ConnectionFilter } from '../foundation/filter.js';

/** Presentation options of the map (not affecting which connections exist). */
export interface MapView {
  gridSize: number;
  showLabels: boolean;
  filterOpen: boolean;
  /** Name of the substation shown; the first one when unset or unknown. */
  substation?: string;
}

export type FilterChangeEvent = CustomEvent<Partial<ConnectionFilter>>;
export type ViewChangeEvent = CustomEvent<Partial<MapView>>;

const formatIcons: Record<ExportFormat, string> = {
  svg: 'polyline',
  png: 'image',
  pdf: 'picture_as_pdf',
};

export const minGridSize = 4;
export const maxGridSize = 128;
/** Factor one zoom button press scales the diagram by. */
export const zoomFactor = 1.25;

/** Scales a grid size, keeping it within limits and to one decimal. */
export function zoomGridSize(gridSize: number, factor: number): number {
  return Math.min(
    maxGridSize,
    Math.max(minGridSize, Math.round(gridSize * factor * 10) / 10),
  );
}

export const serviceIcons: Record<Service, string> = {
  GOOSE: 'gooseIcon',
  SV: 'smvIcon',
  Report: 'reportIcon',
};

/** Keys toggling each service together with Ctrl (Command). */
const serviceKeys: Record<Service, string> = {
  GOOSE: 'G',
  SV: 'S',
  Report: 'R',
};

const serviceLabels: Record<Service, () => string> = {
  GOOSE: () => msg('GOOSE'),
  SV: () => msg('Sampled Values'),
  Report: () => msg('Reports'),
};

/**
 * Toolbar above the map: service toggles, the selected IED with direction
 * toggles, zoom, label visibility and the filter panel toggle.
 *
 * Stateless: it renders the given filter and view, and requests changes with
 * `map-filter-change` and `map-view-change` events carrying partial updates.
 *
 * @fires map-filter-change - detail: changed `ConnectionFilter` fields
 * @fires map-view-change - detail: changed `MapView` fields
 * @fires map-zoom-fit - the whole diagram should be fitted into view
 * @fires map-export - detail: `{ scope, format }` of an export to save
 * @fires map-fullscreen - full screen should be entered or left
 * @fires map-ied-locate - detail: an IED picked in the search field
 */
export default class MapToolbar extends ScopedElementsMixin(LitElement) {
  static scopedElements = {
    'oscd-chip-set': OscdChipSet,
    'oscd-filter-chip': OscdFilterChip,
    'oscd-input-chip': OscdInputChip,
    'oscd-icon': OscdIcon,
    'oscd-icon-button': OscdIconButton,
    'oscd-outlined-select': OscdOutlinedSelect,
    'oscd-select-option': OscdSelectOption,
    'oscd-menu': OscdMenu,
    'oscd-menu-item': OscdMenuItem,
    'oscd-divider': OscdDivider,
    'map-ied-search': MapIedSearch,
  };

  @property({ attribute: false })
  filter!: ConnectionFilter;

  @property({ attribute: false })
  view!: MapView;

  /** How many of the filter panel's criteria narrow the shown connections. */
  @property({ type: Number })
  filterCount = 0;

  /** IEDs placed on the document's diagrams, offered by the search. */
  @property({ attribute: false })
  ieds: SearchableIed[] = [];

  /** Whether the map is shown full screen. */
  @property({ type: Boolean })
  fullscreen = false;

  /** Moves the focus to the IED search field. */
  focusSearch(): void {
    this.renderRoot.querySelector<MapIedSearch>('map-ied-search')?.focus();
  }

  /** Names of the document's substations, offered when there are several. */
  @property({ attribute: false })
  substations: string[] = [];

  private changeFilter(detail: Partial<ConnectionFilter>): void {
    this.dispatchEvent(
      new CustomEvent('map-filter-change', {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  @state()
  private exportOpen = false;

  private requestExport(scope: ExportScope, format: ExportFormat): void {
    this.exportOpen = false;
    this.dispatchEvent(
      new CustomEvent('map-export', {
        detail: { scope, format },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private renderExportItem(
    scope: ExportScope,
    format: ExportFormat,
    headline: string,
    supporting: string,
  ): TemplateResult {
    return html`<oscd-menu-item
      class="export-item"
      data-export="${scope}-${format}"
      @click=${() => this.requestExport(scope, format)}
    >
      <oscd-icon slot="start">${formatIcons[format]}</oscd-icon>
      <div slot="headline">${headline}</div>
      <div slot="supporting-text">${supporting}</div>
    </oscd-menu-item>`;
  }

  private renderExport(): TemplateResult {
    return html`<span class="export-anchor">
      <oscd-icon-button
        id="export-button"
        class="export"
        aria-label=${msg('Export image')}
        title=${msg('Export image')}
        aria-haspopup="menu"
        aria-expanded=${this.exportOpen ? 'true' : 'false'}
        @click=${() => {
          this.exportOpen = !this.exportOpen;
        }}
        ><oscd-icon>download</oscd-icon></oscd-icon-button
      >
      <oscd-menu
        anchor="export-button"
        positioning="popover"
        anchor-corner="end-end"
        menu-corner="start-end"
        .open=${this.exportOpen}
        @closed=${() => {
          this.exportOpen = false;
        }}
      >
        <div class="menu-heading">${msg('Whole diagram')}</div>
        ${this.renderExportItem(
          'diagram',
          'svg',
          msg('SVG'),
          msg('Vector drawing, scales without loss'),
        )}
        ${this.renderExportItem(
          'diagram',
          'png',
          msg('PNG'),
          msg('Picture for documents and email'),
        )}
        ${this.renderExportItem(
          'diagram',
          'pdf',
          msg('PDF'),
          msg('Vector document for printing and sharing'),
        )}
        <oscd-divider></oscd-divider>
        <div class="menu-heading">${msg('Visible area')}</div>
        ${this.renderExportItem(
          'view',
          'svg',
          msg('SVG'),
          msg('What you see, as a vector drawing'),
        )}
        ${this.renderExportItem(
          'view',
          'png',
          msg('PNG'),
          msg('What you see, as a picture'),
        )}
        ${this.renderExportItem(
          'view',
          'pdf',
          msg('PDF'),
          msg('What you see, as a document'),
        )}
      </oscd-menu>
    </span>`;
  }

  private changeView(detail: Partial<MapView>): void {
    this.dispatchEvent(
      new CustomEvent('map-view-change', { detail, bubbles: true, composed: true }),
    );
  }

  private handleServiceClick(service: Service): void {
    this.changeFilter({
      services: toggleService(this.filter.services, service),
    });
  }

  private handleZoom(factor: number): void {
    const gridSize = zoomGridSize(this.view.gridSize, factor);
    if (gridSize !== this.view.gridSize) {
      this.changeView({ gridSize });
    }
  }

  private filterLabel(): string {
    const action = this.view.filterOpen
      ? msg('Close the filter panel')
      : msg('Filter connections');
    if (this.filterCount === 0) {
      return action;
    }
    return this.filterCount === 1
      ? msg(str`${action} (1 filter active)`)
      : msg(str`${action} (${this.filterCount} filters active)`);
  }

  private renderSubstations(): TemplateResult | typeof nothing {
    if (this.substations.length < 2) {
      return nothing;
    }
    const shown = this.substations.includes(this.view.substation ?? '')
      ? this.view.substation
      : this.substations[0];
    return html`<oscd-outlined-select
      class="substation"
      aria-label=${msg('Substation')}
      aria-keyshortcuts="Control+[ Control+]"
      title=${msg(
        str`Substation (${shortcut('[')} previous, ${shortcut(']')} next)`,
      )}
      .value=${shown ?? ''}
      @change=${(event: Event) =>
        this.changeView({
          substation: (event.target as OscdOutlinedSelect).value,
        })}
    >
      ${this.substations.map(
        name =>
          html`<oscd-select-option
            value=${name}
            ?selected=${name === shown}
            ><div slot="headline">${name}</div></oscd-select-option
          >`,
      )}
    </oscd-outlined-select>`;
  }

  private renderServices(): TemplateResult {
    return html`<oscd-chip-set class="services" aria-label=${msg('Services')}>
      ${services.map(
        service =>
          html`<oscd-filter-chip
            class="service ${service.toLowerCase()}"
            data-service=${service}
            .label=${serviceLabels[service]()}
            .selected=${this.filter.services.includes(service)}
            title=${msg(
              str`Show or hide ${serviceLabels[service]()} (${shortcut(serviceKeys[service])})`,
            )}
            aria-keyshortcuts="Control+${serviceKeys[service]}"
            @click=${() => this.handleServiceClick(service)}
          >
            <oscd-icon slot="icon">${serviceIcons[service]}</oscd-icon>
          </oscd-filter-chip>`,
      )}
    </oscd-chip-set>`;
  }

  private renderSelection(): TemplateResult | typeof nothing {
    const { ied, incoming, outgoing } = this.filter;
    if (ied === undefined) {
      return nothing;
    }
    return html`<oscd-chip-set class="selection" aria-label=${msg('Selected IED')}>
      <oscd-input-chip
        class="selected-ied"
        .label=${msg(str`IED ${ied}`)}
        @remove=${(event: Event) => {
          event.preventDefault();
          this.changeFilter({ ied: undefined });
        }}
      ></oscd-input-chip>
      <oscd-filter-chip
        class="incoming"
        .label=${msg('Receives')}
        .selected=${incoming}
        @click=${() => this.changeFilter({ incoming: !incoming })}
      ></oscd-filter-chip>
      <oscd-filter-chip
        class="outgoing"
        .label=${msg('Sends')}
        .selected=${outgoing}
        @click=${() => this.changeFilter({ outgoing: !outgoing })}
      ></oscd-filter-chip>
    </oscd-chip-set>`;
  }

  private renderViewControls(): TemplateResult {
    const { gridSize, showLabels, filterOpen } = this.view;
    const fullscreenLabel = this.fullscreen
      ? msg('Exit full screen')
      : msg('Full screen');
    return html`<div class="view">
      <map-ied-search
        .ieds=${this.ieds}
        .substation=${this.view.substation ?? this.substations[0]}
      ></map-ied-search>
      <oscd-icon-button
        class="zoom-out"
        aria-label=${msg('Zoom out')}
        aria-keyshortcuts="Control+- -"
        title=${msg(str`Zoom out (${shortcut('-')} or -)`)}
        ?disabled=${gridSize <= minGridSize}
        @click=${() => this.handleZoom(1 / zoomFactor)}
        ><oscd-icon>zoom_out</oscd-icon></oscd-icon-button
      >
      <oscd-icon-button
        class="zoom-in"
        aria-label=${msg('Zoom in')}
        aria-keyshortcuts="Control+= +"
        title=${msg(str`Zoom in (${shortcut('=')} or +)`)}
        ?disabled=${gridSize >= maxGridSize}
        @click=${() => this.handleZoom(zoomFactor)}
        ><oscd-icon>zoom_in</oscd-icon></oscd-icon-button
      >
      <oscd-icon-button
        class="zoom-fit"
        aria-label=${msg('Zoom to fit')}
        aria-keyshortcuts="Control+0 0"
        title=${msg(str`Zoom to fit (${shortcut('0')} or 0)`)}
        @click=${() =>
          this.dispatchEvent(
            new CustomEvent('map-zoom-fit', { bubbles: true, composed: true }),
          )}
        ><oscd-icon>fit_screen</oscd-icon></oscd-icon-button
      >
      ${this.renderExport()}
      <oscd-icon-button
        class="fullscreen"
        aria-label=${fullscreenLabel}
        title=${fullscreenLabel}
        @click=${() =>
          this.dispatchEvent(
            new CustomEvent('map-fullscreen', { bubbles: true, composed: true }),
          )}
        ><oscd-icon
          >${this.fullscreen ? 'fullscreen_exit' : 'fullscreen'}</oscd-icon
        ></oscd-icon-button
      >
      <oscd-icon-button
        class="labels"
        toggle
        .selected=${showLabels}
        aria-label=${msg('Show labels')}
        aria-keyshortcuts="Control+L L"
        title=${msg(str`Show labels (${shortcut('L')} or L)`)}
        @click=${() => this.changeView({ showLabels: !showLabels })}
        ><oscd-icon>font_download_off</oscd-icon
        ><oscd-icon slot="selected">font_download</oscd-icon></oscd-icon-button
      >
      <span
        class=${classMap({
          'filter-toggle': true,
          open: filterOpen,
          active: this.filterCount > 0,
        })}
      >
        <oscd-icon-button
          class="filter"
          toggle
          .selected=${filterOpen}
          aria-label=${this.filterLabel()}
          aria-keyshortcuts="F"
          title=${msg(str`${this.filterLabel()} (F)`)}
          @click=${() => this.changeView({ filterOpen: !filterOpen })}
          ><oscd-icon>filter_alt</oscd-icon
          ><oscd-icon slot="selected">filter_alt</oscd-icon></oscd-icon-button
        >
        ${this.filterCount > 0
          ? html`<span class="badge" aria-hidden="true">${this.filterCount}</span>`
          : nothing}
      </span>
    </div>`;
  }

  render(): TemplateResult {
    return html`<nav aria-label=${msg('Communication map toolbar')}>
      ${this.renderSubstations()} ${this.renderServices()}
      ${this.renderSelection()}
      <span class="spacer"></span>
      ${this.renderViewControls()}
    </nav>`;
  }

  static styles = css`
    :host {
      display: block;
    }

    nav {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      padding: 4px 8px;
    }

    .spacer {
      flex: 1;
    }

    .view {
      display: flex;
      align-items: center;
    }

    map-ied-search {
      margin-right: 8px;
    }

    .export-anchor {
      position: relative;
      display: inline-flex;
    }

    .menu-heading {
      padding: 8px 16px 4px;
      color: var(--oscd-base01);
      font-size: 0.8em;
      font-weight: 500;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .substation {
      min-width: 160px;
      --md-outlined-field-top-space: 6px;
      --md-outlined-field-bottom-space: 6px;
    }

    .service.goose {
      --md-filter-chip-icon-color: var(--oscd-map-goose-color);
      --md-filter-chip-selected-leading-icon-color: var(--oscd-map-goose-color);
    }

    .service.sv {
      --md-filter-chip-icon-color: var(--oscd-map-sv-color);
      --md-filter-chip-selected-leading-icon-color: var(--oscd-map-sv-color);
    }

    .service.report {
      --md-filter-chip-icon-color: var(--oscd-map-report-color);
      --md-filter-chip-selected-leading-icon-color: var(
        --oscd-map-report-color
      );
    }

    .filter-toggle {
      position: relative;
      display: inline-flex;
      border-radius: 50%;
    }

    /* Open panel: a tinted disc behind the button. */
    .filter-toggle.open {
      background: color-mix(in srgb, var(--oscd-primary) 18%, transparent);
    }

    /* Active filters: the funnel takes the primary colour, with a count. */
    .filter-toggle.active {
      --md-icon-button-icon-color: var(--oscd-primary);
      --md-icon-button-hover-icon-color: var(--oscd-primary);
      --md-icon-button-selected-icon-color: var(--oscd-primary);
      --md-icon-button-selected-hover-icon-color: var(--oscd-primary);
    }

    .badge {
      position: absolute;
      top: 2px;
      right: 2px;
      min-width: 16px;
      height: 16px;
      padding: 0 4px;
      box-sizing: border-box;
      border-radius: 8px;
      background: var(--oscd-secondary);
      color: var(--oscd-base3);
      font-size: 11px;
      font-weight: 500;
      line-height: 16px;
      text-align: center;
      pointer-events: none;
    }
  `;
}
