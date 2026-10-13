import { css, html, LitElement, nothing, TemplateResult } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { msg, str } from '@lit/localize';
import { ScopedElementsMixin } from '@open-wc/scoped-elements/lit-element.js';

import { OscdMenu } from '@omicronenergy/oscd-ui/menu/OscdMenu.js';
import { OscdMenuItem } from '@omicronenergy/oscd-ui/menu/OscdMenuItem.js';
import { OscdOutlinedSearchField } from '@omicronenergy/oscd-ui/search-field/OscdOutlinedSearchField.js';

import { searchIeds, type SearchableIed } from '../foundation/ied-search.js';
import { shortcut } from '../foundation/shortcuts.js';

export type IedLocateEvent = CustomEvent<SearchableIed>;

/**
 * Search field finding IEDs placed on the diagrams: typing a few characters
 * lists the best matches in a menu below the field. Enter picks the best
 * match; the down arrow moves into the menu to pick another one.
 *
 * @fires map-ied-locate - detail: the picked `SearchableIed`
 */
export default class MapIedSearch extends ScopedElementsMixin(LitElement) {
  static scopedElements = {
    'oscd-outlined-search-field': OscdOutlinedSearchField,
    'oscd-menu': OscdMenu,
    'oscd-menu-item': OscdMenuItem,
  };

  /** IEDs that can be found. */
  @property({ attribute: false })
  ieds: SearchableIed[] = [];

  /** Substation shown, whose IEDs are listed first. */
  @property({ type: String })
  substation?: string;

  @state()
  private text = '';

  @state()
  private open = false;

  @query('oscd-outlined-search-field')
  field!: OscdOutlinedSearchField;

  /** Matches of the current text. */
  get results(): SearchableIed[] {
    return searchIeds(this.ieds, this.text, this.substation);
  }

  /** Focuses the field and selects its text, also before it first rendered. */
  override focus(): void {
    const { field } = this;
    field.focus();
    field.updateComplete.then(() => {
      field.focus();
      field.select();
    });
  }

  private pick(ied: SearchableIed): void {
    this.open = false;
    this.text = '';
    this.dispatchEvent(
      new CustomEvent('map-ied-locate', {
        detail: ied,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleInput(event: Event): void {
    this.text = (event.target as OscdOutlinedSearchField).value;
    this.open = this.text.trim() !== '';
  }

  private handleKeydown(event: KeyboardEvent): void {
    const [best] = this.results;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (best && this.text.trim() !== '') {
        this.pick(best);
      }
    } else if (event.key === 'ArrowDown' && best) {
      // Into the menu, which handles its own arrow keys from there.
      event.preventDefault();
      this.open = true;
      this.updateComplete.then(() =>
        this.renderRoot.querySelector<HTMLElement>('oscd-menu-item')?.focus(),
      );
    } else if (event.key === 'Escape') {
      // Escape first closes the menu, then clears the text.
      event.stopPropagation();
      if (this.open) {
        this.open = false;
      } else {
        this.text = '';
      }
    }
  }

  /** A result was picked, by click or keyboard. */
  private handleCloseMenu(
    event: CustomEvent<{ initiator: HTMLElement }>,
  ): void {
    const name = event.detail.initiator?.dataset.name;
    const ied = this.results.find(result => result.name === name);
    if (ied) {
      this.pick(ied);
    }
  }

  private renderResult(ied: SearchableIed): TemplateResult {
    const other = ied.substation !== this.substation;
    // Descriptions repeating the name add nothing.
    const desc = ied.desc !== ied.name ? ied.desc : undefined;
    const detail = [desc, other ? ied.substation : '']
      .filter(Boolean)
      .join(' · ');
    return html`<oscd-menu-item class="result" data-name=${ied.name}>
      <div slot="headline">${ied.name}</div>
      ${detail ? html`<div slot="supporting-text">${detail}</div>` : nothing}
    </oscd-menu-item>`;
  }

  render(): TemplateResult {
    const { results } = this;
    return html`<oscd-outlined-search-field
        id="field"
        placeholder=${msg(str`Find IED (${shortcut('F')})`)}
        aria-label=${msg('Find IED')}
        aria-keyshortcuts="Control+F /"
        title=${msg(str`Find IED (${shortcut('F')} or /)`)}
        .value=${this.text}
        @input=${this.handleInput}
        @keydown=${this.handleKeydown}
      ></oscd-outlined-search-field>
      <oscd-menu
        anchor="field"
        positioning="popover"
        default-focus="none"
        skip-restore-focus
        .open=${this.open}
        @close-menu=${this.handleCloseMenu}
        @closed=${() => {
          this.open = false;
        }}
      >
        ${results.length > 0
          ? results.map(ied => this.renderResult(ied))
          : html`<oscd-menu-item class="none" disabled
              ><div slot="headline">${msg('No IED found')}</div></oscd-menu-item
            >`}
      </oscd-menu>`;
  }

  static styles = css`
    :host {
      display: inline-block;
    }

    oscd-outlined-search-field {
      width: 220px;
      --md-outlined-field-top-space: 6px;
      --md-outlined-field-bottom-space: 6px;
      --md-outlined-text-field-container-shape: 20px;
    }

    oscd-menu {
      min-width: 220px;
    }
  `;
}
