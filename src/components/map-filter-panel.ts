import { css, html, LitElement, nothing, PropertyValues, TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { msg, str } from '@lit/localize';
import { ScopedElementsMixin } from '@open-wc/scoped-elements/lit-element.js';

import { OscdCheckbox } from '@omicronenergy/oscd-ui/checkbox/OscdCheckbox.js';
import { OscdChipSet } from '@omicronenergy/oscd-ui/chips/OscdChipSet.js';
import { OscdFilterChip } from '@omicronenergy/oscd-ui/chips/OscdFilterChip.js';
import { OscdIcon } from '@omicronenergy/oscd-ui/icon/OscdIcon.js';
import { OscdIconButton } from '@omicronenergy/oscd-ui/iconbutton/OscdIconButton.js';
import { OscdList } from '@omicronenergy/oscd-ui/list/OscdList.js';
import { OscdListItem } from '@omicronenergy/oscd-ui/list/OscdListItem.js';
import { OscdOutlinedTextField } from '@omicronenergy/oscd-ui/textfield/OscdOutlinedTextField.js';
import {
  OscdSelectionList,
  type SelectItem,
} from '@omicronenergy/oscd-ui/selection-list/OscdSelectionList.js';
import { OscdTree } from '@omicronenergy/oscd-ui/tree/OscdTree.js';
import type {
  TreeNode,
  TreeRenderContext,
} from '@omicronenergy/oscd-ui/tree/OscdTree.js';
import { OscdTextButton } from '@omicronenergy/oscd-ui/button/OscdTextButton.js';

import {
  clearCriteria,
  emptyOptions,
  isFilterActive,
  parsePrioritySelection,
  parseVlanSelection,
  toggleValue,
  type ConnectionFilter,
  type FilterOptions,
} from '../foundation/filter.js';
import { formatVlanId } from '../foundation/comm-params.js';
import { connectionTitle } from '../foundation/inputs.js';
import type { Connection } from '../foundation/types.js';
import { serviceIcons } from './map-toolbar.js';

type TextCriterion = 'sourceIed' | 'targetIed' | 'controlBlock';

type Section = 'names' | 'vlans' | 'priorities' | 'manufacturers' | 'connections';

/** A manufacturer, or one of its IED types, in the manufacturer tree. */
type TypeNode = TreeNode & {
  label: string;
  /** Secondary text: type count or connection count. */
  detail: string;
  children?: TypeNode[];
};

/**
 * A row of the manufacturer tree: name and, dimmed, its count. Rendered
 * inside the tree's shadow root, so styled inline.
 */
function renderTypeNode({ node }: TreeRenderContext<TypeNode>): TemplateResult {
  return html`<span
    style="display: flex; gap: 8px; align-items: baseline; width: 100%"
    ><span style="flex: 1; overflow: hidden; text-overflow: ellipsis"
      >${node.label}</span
    ><span style="flex: none; opacity: 0.7; font-size: 0.85em"
      >${node.detail}</span
    ></span
  >`;
}

function connectionCount(count: number): string {
  return count === 1 ? msg('1 connection') : msg(str`${count} connections`);
}


/**
 * Side panel narrowing the shown connections, and listing them.
 *
 * Criteria are grouped in collapsible sections showing how many values are
 * selected. Text criteria match IED and control block names. VLANs and
 * priorities can be typed as comma separated values or ticked; both stay in
 * sync. The values offered come from `options`: with an IED selected, the
 * host passes only what that IED's connections use. The connection list
 * gives keyboard access to every shown connection, including those whose
 * IEDs are not placed on a diagram.
 *
 * @fires map-filter-change - detail: changed `ConnectionFilter` fields
 * @fires map-view-change - detail: `{ filterOpen: false }` when closed
 * @fires map-connection-select - detail: `{ id }` of a listed connection
 */
export default class MapFilterPanel extends ScopedElementsMixin(LitElement) {
  static scopedElements = {
    'oscd-checkbox': OscdCheckbox,
    'oscd-chip-set': OscdChipSet,
    'oscd-filter-chip': OscdFilterChip,
    'oscd-icon': OscdIcon,
    'oscd-icon-button': OscdIconButton,
    'oscd-list': OscdList,
    'oscd-list-item': OscdListItem,
    'oscd-outlined-text-field': OscdOutlinedTextField,
    'oscd-text-button': OscdTextButton,
    'oscd-selection-list': OscdSelectionList,
    'oscd-tree': OscdTree,
  };

  @property({ attribute: false })
  filter!: ConnectionFilter;

  @property({ attribute: false })
  options: FilterOptions = emptyOptions();

  /** Connections shown with the current filter. */
  @property({ attribute: false })
  connections: Connection[] = [];

  /** Ids of the shown connections drawn on a diagram. */
  @property({ attribute: false })
  drawn: Set<string> = new Set();

  @property({ attribute: false })
  selectedConnection?: string;

  /** VLAN input as typed, kept while it parses to the selected VLANs. */
  @state()
  private vlanText = '';

  @state()
  private priorityText = '';

  /** Folded sections; all but the name criteria start folded. */
  @state()
  private collapsed = new Set<Section>([
    'vlans',
    'priorities',
    'manufacturers',
    'connections',
  ]);

  /** Manufacturers whose types are listed. */
  @state()
  private expanded = new Set<string>();

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has('filter')) {
      return;
    }
    const { vlans, priorities } = this.filter;
    if (
      parseVlanSelection(this.vlanText, this.options.vlans).join() !==
      vlans.join()
    ) {
      this.vlanText = vlans.join(', ');
    }
    if (
      parsePrioritySelection(this.priorityText, this.options.priorities).join() !==
      priorities.join()
    ) {
      this.priorityText = priorities.join(', ');
    }
  }

  private emit(type: string, detail: unknown): void {
    this.dispatchEvent(
      new CustomEvent(type, { detail, bubbles: true, composed: true }),
    );
  }

  private changeFilter(detail: Partial<ConnectionFilter>): void {
    this.emit('map-filter-change', detail);
  }

  private handleTextInput(criterion: TextCriterion, event: Event): void {
    const { value } = event.target as HTMLInputElement;
    this.changeFilter({ [criterion]: value });
  }

  private handleVlanInput(event: Event): void {
    this.vlanText = (event.target as HTMLInputElement).value;
    this.changeFilter({
      vlans: parseVlanSelection(this.vlanText, this.options.vlans),
    });
  }

  private handlePriorityInput(event: Event): void {
    this.priorityText = (event.target as HTMLInputElement).value;
    this.changeFilter({
      priorities: parsePrioritySelection(
        this.priorityText,
        this.options.priorities,
      ),
    });
  }

  private toggleSection(section: Section, event: Event): void {
    const { open } = event.target as HTMLDetailsElement;
    if (open === !this.collapsed.has(section)) {
      return;
    }
    const collapsed = new Set(this.collapsed);
    if (open) {
      collapsed.delete(section);
    } else {
      collapsed.add(section);
    }
    this.collapsed = collapsed;
  }

  private renderSection(
    section: Section,
    title: string,
    badge: string | undefined,
    content: TemplateResult,
  ): TemplateResult {
    return html`<details
      class="section ${section}"
      ?open=${!this.collapsed.has(section)}
      @toggle=${(event: Event) => this.toggleSection(section, event)}
    >
      <summary>
        <oscd-icon class="chevron">chevron_right</oscd-icon>
        <span class="title">${title}</span>
        ${badge ? html`<span class="badge">${badge}</span>` : nothing}
      </summary>
      <div class="section-body">${content}</div>
    </details>`;
  }

  private renderTextField(criterion: TextCriterion, label: string): TemplateResult {
    return html`<oscd-outlined-text-field
      class=${criterion}
      .label=${label}
      .value=${this.filter[criterion]}
      title=${msg('Space separated, any term matches')}
      @input=${(event: Event) => this.handleTextInput(criterion, event)}
    ></oscd-outlined-text-field>`;
  }

  private renderNames(): TemplateResult {
    const { sourceIed, targetIed, controlBlock } = this.filter;
    const active = [sourceIed, targetIed, controlBlock].filter(
      text => text.trim() !== '',
    ).length;
    return this.renderSection(
      'names',
      msg('Names'),
      active ? `${active}` : undefined,
      html`<p class="hint">${msg('Space separated terms, any term matches')}</p>
        ${this.renderTextField('sourceIed', msg('Source IED'))}
        ${this.renderTextField('targetIed', msg('Target IED'))}
        ${this.renderTextField('controlBlock', msg('Control block'))}`,
    );
  }

  private renderVlans(): TemplateResult | typeof nothing {
    const { vlans, counts } = this.options;
    if (vlans.length === 0) {
      return nothing;
    }
    const selected = this.filter.vlans;
    return this.renderSection(
      'vlans',
      msg('VLANs'),
      selected.length
        ? msg(str`${selected.length} of ${vlans.length}`)
        : `${vlans.length}`,
      html`<oscd-outlined-text-field
          class="vlan-text"
          .label=${msg('VLAN IDs')}
          .value=${this.vlanText}
          supporting-text=${msg('Comma separated, decimal or hex (0x65)')}
          @input=${this.handleVlanInput}
        ></oscd-outlined-text-field>
        <div class="bulk">
          <oscd-text-button
            class="vlans-all"
            ?disabled=${selected.length === vlans.length}
            @click=${() => this.changeFilter({ vlans: [...vlans] })}
            >${msg('Select all')}</oscd-text-button
          >
          <oscd-text-button
            class="vlans-none"
            ?disabled=${selected.length === 0}
            @click=${() => this.changeFilter({ vlans: [] })}
            >${msg('Clear')}</oscd-text-button
          >
        </div>
        <oscd-selection-list
          class="vlan-options"
          multiselect
          filterable
          searchhelper=${msg('Filter VLANs')}
          aria-label=${msg('VLAN IDs')}
          .items=${vlans.map(
            (vlan): SelectItem => ({
              headline: `${formatVlanId(vlan)} (${vlan})`,
              supportingText: connectionCount(counts.vlans.get(vlan) ?? 0),
              selected: selected.includes(vlan),
            }),
          )}
          @selection-list-change=${(event: Event) => {
            const { items } = event.target as OscdSelectionList;
            this.changeFilter({
              vlans: vlans.filter((_, k) => items[k]?.selected),
            });
          }}
        ></oscd-selection-list>`,
    );
  }

  private renderPriorities(): TemplateResult | typeof nothing {
    const { priorities, counts } = this.options;
    if (priorities.length === 0) {
      return nothing;
    }
    const selected = this.filter.priorities;
    return this.renderSection(
      'priorities',
      msg('VLAN priorities'),
      selected.length ? `${selected.length}` : undefined,
      html`<oscd-outlined-text-field
          class="priority-text"
          .label=${msg('VLAN priorities')}
          .value=${this.priorityText}
          supporting-text=${msg('Comma separated')}
          @input=${this.handlePriorityInput}
        ></oscd-outlined-text-field>
        <oscd-chip-set aria-label=${msg('VLAN priorities')}>
          ${priorities.map(
            priority =>
              html`<oscd-filter-chip
                data-priority=${priority}
                .label=${`${priority} (${counts.priorities.get(priority) ?? 0})`}
                .selected=${selected.includes(priority)}
                @click=${() =>
                  this.changeFilter({
                    priorities: toggleValue(selected, priority),
                  })}
              ></oscd-filter-chip>`,
          )}
        </oscd-chip-set>`,
    );
  }

  private renderManufacturers(): TemplateResult | typeof nothing {
    const { manufacturers, counts } = this.options;
    if (manufacturers.size === 0) {
      return nothing;
    }
    const selected = this.filter.types;
    const data: TypeNode[] = Array.from(manufacturers, ([manufacturer, types]) => {
      const keys = types.map(type => `${manufacturer}|${type}`);
      const chosen = keys.filter(key => selected.includes(key)).length;
      return {
        id: `manufacturer:${manufacturer}`,
        label: manufacturer || msg('Unknown manufacturer'),
        detail: chosen
          ? msg(str`${chosen} of ${types.length} selected`)
          : types.length === 1
            ? msg('1 type')
            : msg(str`${types.length} types`),
        children: types.map((type, k) => ({
          id: keys[k],
          label: type || msg('Unknown type'),
          detail: connectionCount(counts.types.get(keys[k]) ?? 0),
          // An empty list marks a leaf (no list: not loaded yet).
          children: [],
        })),
      };
    });
    // Manufacturers with selected types are shown expanded.
    const expanded = new Set(this.expanded);
    data.forEach(({ id, children }) => {
      if (children?.some(child => selected.includes(child.id ?? ''))) {
        expanded.add(id!);
      }
    });
    return this.renderSection(
      'manufacturers',
      msg('Manufacturers and types'),
      selected.length ? `${selected.length}` : undefined,
      html`<oscd-tree
        class="types"
        aria-label=${msg('Manufacturers and types')}
        selectionMode="multiple"
        .data=${data}
        .selectedIds=${selected}
        .expandedIds=${Array.from(expanded)}
        .isSelectable=${(node: TypeNode) => node.children?.length === 0}
        .renderItem=${renderTypeNode}
        @selected-ids-changed=${(event: CustomEvent<{ selectedIds: string[] }>) =>
          this.changeFilter({ types: event.detail.selectedIds })}
        @expanded-ids-changed=${(event: CustomEvent<{ expandedIds: string[] }>) => {
          this.expanded = new Set(event.detail.expandedIds);
        }}
      ></oscd-tree>`,
    );
  }

  private renderConnection(connection: Connection): TemplateResult {
    const onDiagram = this.drawn.has(connection.id);
    const inputs = connection.inputs.length;
    return html`<oscd-list-item
      type="button"
      data-id=${connection.id}
      class=${this.selectedConnection === connection.id ? 'selected' : ''}
      @click=${() => this.emit('map-connection-select', { id: connection.id })}
    >
      <oscd-icon slot="start">${serviceIcons[connection.service]}</oscd-icon>
      <div slot="headline">${connectionTitle(connection)}</div>
      <div slot="supporting-text">
        ${inputs === 1 ? msg('1 input') : msg(str`${inputs} inputs`)}${onDiagram
          ? nothing
          : html` · ${msg('not on the diagram')}`}
      </div>
    </oscd-list-item>`;
  }

  private renderScope(): TemplateResult | typeof nothing {
    const { ied } = this.filter;
    if (ied === undefined) {
      return nothing;
    }
    return html`<p class="scope">
      <oscd-icon>filter_center_focus</oscd-icon>
      <span>${msg(str`Showing the options used by IED ${ied}`)}</span>
    </p>`;
  }

  render(): TemplateResult {
    const count = this.connections.length;
    return html`<aside aria-label=${msg('Filter connections')}>
      <header>
        <h2>${msg('Filter connections')}</h2>
        <oscd-icon-button
          class="reset"
          aria-label=${msg('Reset filter')}
          title=${msg('Reset filter')}
          ?disabled=${!isFilterActive(this.filter)}
          @click=${() => this.changeFilter(clearCriteria(this.filter))}
          ><oscd-icon>restart_alt</oscd-icon></oscd-icon-button
        >
        <oscd-icon-button
          class="close"
          aria-label=${msg('Close')}
          title=${msg('Close')}
          @click=${() => this.emit('map-view-change', { filterOpen: false })}
          ><oscd-icon>close</oscd-icon></oscd-icon-button
        >
      </header>
      <div class="scroll">
        ${this.renderScope()} ${this.renderNames()} ${this.renderVlans()}
        ${this.renderPriorities()} ${this.renderManufacturers()}
        ${this.renderSection(
          'connections',
          count === 1 ? msg('1 connection') : msg(str`${count} connections`),
          undefined,
          html`<oscd-list class="connections">
            ${this.connections.map(connection => this.renderConnection(connection))}
          </oscd-list>`,
        )}
      </div>
    </aside>`;
  }

  static styles = css`
    :host {
      display: block;
      overflow: hidden;
      background: var(--oscd-base3);
      color: var(--oscd-base00);
    }

    /* The header stays put; only the criteria and connections scroll. */
    aside {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .scroll {
      flex: auto;
      min-height: 0;
      overflow: auto;
    }

    header {
      flex: none;
      display: flex;
      align-items: center;
      padding: 4px 8px 4px 16px;
      background: var(--oscd-base3);
      border-bottom: 1px solid var(--oscd-base2);
    }

    h2 {
      flex: 1;
      margin: 0;
      font-size: 1.1em;
      font-weight: 500;
    }

    .scope {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 8px 16px 0;
      padding: 8px 12px;
      border-radius: var(--oscd-shape);
      background: var(--oscd-base2);
      font-size: 0.9em;
    }

    .section {
      border-bottom: 1px solid var(--oscd-base2);
    }

    summary {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 10px 16px 10px 8px;
      cursor: pointer;
      list-style: none;
      font-weight: 500;
    }

    summary::-webkit-details-marker {
      display: none;
    }

    .chevron {
      transition: transform 0.15s;
    }

    .section[open] .chevron {
      transform: rotate(90deg);
    }

    .title {
      flex: 1;
    }

    .badge {
      padding: 0 8px;
      border-radius: 10px;
      background: var(--oscd-base2);
      color: var(--oscd-base01);
      font-size: 0.8em;
      font-weight: 500;
      line-height: 20px;
    }

    .section-body {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 0 16px 12px;
    }

    .section.connections .section-body {
      padding: 0 0 8px;
    }

    .hint {
      margin: 0;
      font-size: 0.85em;
      color: var(--oscd-base01);
    }

    .bulk {
      display: flex;
      justify-content: flex-end;
      margin: -4px 0;
    }

    /* Long VLAN lists scroll inside the section, below its filter field. */
    .vlan-options {
      max-height: 320px;
      overflow: auto;
      border: 1px solid var(--oscd-base2);
      border-radius: var(--oscd-shape);
    }

    .types {
      border: 1px solid var(--oscd-base2);
      border-radius: var(--oscd-shape);
    }

    .count {
      flex: none;
      margin-left: 8px;
      color: var(--oscd-base01);
      font-size: 0.85em;
      font-variant-numeric: tabular-nums;
    }

    oscd-list-item.selected {
      --md-list-item-label-text-color: var(--oscd-primary);
    }
  `;
}
