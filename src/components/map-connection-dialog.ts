import { css, html, LitElement, nothing, TemplateResult } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { msg, str } from '@lit/localize';
import { ScopedElementsMixin } from '@open-wc/scoped-elements/lit-element.js';

import { OscdDialog } from '@omicronenergy/oscd-ui/dialog/OscdDialog.js';
import { OscdIcon } from '@omicronenergy/oscd-ui/icon/OscdIcon.js';
import { OscdIconButton } from '@omicronenergy/oscd-ui/iconbutton/OscdIconButton.js';
import { OscdSwitch } from '@omicronenergy/oscd-ui/switch/OscdSwitch.js';
import { OscdTextButton } from '@omicronenergy/oscd-ui/button/OscdTextButton.js';

import { formatVlan } from '../foundation/comm-params.js';
import {
  connectionTitle,
  existingSupervision,
  inputDestination,
  inputSource,
  isBound,
  type InputText,
} from '../foundation/inputs.js';
import { readStored, writeStored } from '../foundation/storage.js';
import type { Connection } from '../foundation/types.js';
import { serviceIcons } from './map-toolbar.js';

export type RemoveInputsEvent = CustomEvent<{ inputs: Element[] }>;

/** Browser storage key remembering whether message information is shown. */
export const detailsStorageKey =
  'oscd-editor-map-communication:message-information';

/** Browser storage key remembering whether quality inputs are shown. */
export const qualityStorageKey = 'oscd-editor-map-communication:show-quality';

/** A remembered on/off choice; off unless stored as on. */
function loadChoice(key: string): boolean {
  return readStored(key) === 'on';
}

function saveChoice(key: string, on: boolean): void {
  writeStored(key, on ? 'on' : 'off');
}

/** True for inputs bound to a quality attribute (`q`). */
export function isQualityInput(input: Element): boolean {
  const daName = input.getAttribute('daName') ?? '';
  return daName === 'q' || daName.endsWith('.q');
}

/**
 * Dialog with the details of one connection: communication parameters,
 * subscription supervision and the mapping of each input, with actions to
 * remove single inputs or all of them.
 *
 * @fires map-remove-inputs - detail: `{ inputs }` the user asked to remove
 * @fires map-connection-close - the dialog was closed
 */
export default class MapConnectionDialog extends ScopedElementsMixin(
  LitElement,
) {
  static scopedElements = {
    'oscd-dialog': OscdDialog,
    'oscd-icon': OscdIcon,
    'oscd-icon-button': OscdIconButton,
    'oscd-switch': OscdSwitch,
    'oscd-text-button': OscdTextButton,
  };

  @property({ attribute: false })
  connection?: Connection;

  /** Whether quality inputs are listed; remembered per browser. */
  @state()
  showQuality = loadChoice(qualityStorageKey);

  /** Whether message information is expanded; remembered per browser. */
  @state()
  detailsOpen = loadChoice(detailsStorageKey);

  private handleDetailsToggle(event: Event): void {
    const { open } = event.target as HTMLDetailsElement;
    if (open === this.detailsOpen) {
      return;
    }
    this.detailsOpen = open;
    saveChoice(detailsStorageKey, open);
  }

  @query('oscd-dialog')
  dialog!: OscdDialog;

  private handleClosed(): void {
    this.dispatchEvent(
      new CustomEvent('map-connection-close', { bubbles: true, composed: true }),
    );
  }

  private removeInputs(inputs: Element[]): void {
    this.dispatchEvent(
      new CustomEvent('map-remove-inputs', {
        detail: { inputs },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private detailRows(connection: Connection): [string, string][] {
    const { controlBlock, comm } = connection;
    const rows: [string, string | null | undefined][] = [
      [msg('Data set'), controlBlock.getAttribute('datSet')],
      [msg('Configuration revision'), controlBlock.getAttribute('confRev')],
      [msg('GOOSE ID'), controlBlock.getAttribute('appID')],
      [msg('SMV ID'), controlBlock.getAttribute('smvID')],
      [msg('Report ID'), controlBlock.getAttribute('rptID')],
      [msg('VLAN ID'), comm.vlanId ? formatVlan(comm.vlanId) : undefined],
      [msg('VLAN priority'), comm.vlanPriority],
      [msg('Application ID'), comm.appId],
      [msg('MAC address'), comm.macAddress],
      [msg('Minimum time'), comm.minTime],
      [msg('Maximum time'), comm.maxTime],
    ];
    return rows.filter((row): row is [string, string] => !!row[1]);
  }

  /** Key values shown on the folded message information. */
  private detailPreview(connection: Connection): string {
    const { controlBlock, comm } = connection;
    const values = [
      comm.vlanId ? `VLAN ${formatVlan(comm.vlanId)}` : undefined,
      comm.appId ? `APPID ${comm.appId}` : undefined,
      comm.macAddress,
      controlBlock.getAttribute('datSet') ?? undefined,
    ].filter((value): value is string => !!value);
    return values.slice(0, 3).join(' · ');
  }

  private renderDetails(connection: Connection): TemplateResult {
    return html`<table class="details">
      <tbody>
        ${this.detailRows(connection).map(
          ([label, value]) =>
            html`<tr>
                <th scope="row">${label}</th>
                <td>${value}</td>
              </tr>`,
        )}
      </tbody>
    </table>`;
  }

  private renderSupervision(
    connection: Connection,
  ): TemplateResult | typeof nothing {
    const supervision = existingSupervision(
      connection.controlBlock,
      connection.target.ied,
    );
    if (!supervision) {
      return nothing;
    }
    const desc =
      supervision.getAttribute('desc') ??
      supervision.querySelector(':scope > DOI')?.getAttribute('desc');
    const name = `${supervision.closest('LDevice')?.getAttribute('inst') ?? ''}/${supervision.getAttribute('prefix') ?? ''}${supervision.getAttribute('lnClass')}${supervision.getAttribute('inst') ?? ''}`;
    return html`<p class="supervision">
      <oscd-icon>monitor_heart</oscd-icon>
      ${msg(str`Supervision: ${name}`)}${desc ? ` (${desc})` : nothing}
    </p>`;
  }

  private renderText({ reference, desc }: InputText): TemplateResult {
    return html`<span class="reference">${reference}</span>${desc
      ? html`<span class="desc">${desc}</span>`
      : nothing}`;
  }

  private renderInputs(connection: Connection): TemplateResult {
    const inputs = connection.inputs
      .filter(isBound)
      .filter(input => this.showQuality || !isQualityInput(input));
    return html`<table class="inputs">
      <thead>
        <tr>
          <th scope="col">${msg('Source')}</th>
          <th scope="col">${msg('Destination')}</th>
          <th scope="col"><span class="visually-hidden">${msg('Remove')}</span></th>
        </tr>
      </thead>
      <tbody>
        ${inputs.map(
          input =>
            html`<tr>
              <td>${this.renderText(inputSource(input, connection.controlBlock))}</td>
              <td>${this.renderText(inputDestination(input))}</td>
              <td>
                <oscd-icon-button
                  class="remove-input"
                  aria-label=${msg('Remove input')}
                  title=${msg('Remove input')}
                  @click=${() => this.removeInputs([input])}
                  ><oscd-icon>delete</oscd-icon></oscd-icon-button
                >
              </td>
            </tr>`,
        )}
      </tbody>
    </table>`;
  }

  private renderContent(connection: Connection): TemplateResult {
    return html`<div slot="headline" class="headline">
        <oscd-icon>${serviceIcons[connection.service]}</oscd-icon>
        ${connectionTitle(connection)}
      </div>
      <div slot="content" class="content">
        ${this.renderSupervision(connection)}
        <details
          ?open=${this.detailsOpen}
          @toggle=${this.handleDetailsToggle}
        >
          <summary title=${this.detailsOpen
            ? msg('Hide message information')
            : msg('Show message information')}>
            <oscd-icon class="chevron">chevron_right</oscd-icon>
            <span class="summary-title">${msg('Message information')}</span>
            ${this.detailsOpen
              ? nothing
              : html`<span class="preview">${this.detailPreview(connection)}</span>`}
          </summary>
          ${this.renderDetails(connection)}
        </details>
        <label class="quality">
          ${msg('Show quality')}
          <oscd-switch
            .selected=${this.showQuality}
            @change=${(event: Event) => {
              this.showQuality = (event.target as OscdSwitch).selected;
              saveChoice(qualityStorageKey, this.showQuality);
            }}
          ></oscd-switch>
        </label>
        ${this.renderInputs(connection)}
      </div>
      <div slot="actions">
        <oscd-text-button
          class="remove-all"
          @click=${() => this.removeInputs(connection.inputs)}
          >${msg('Remove all')}<oscd-icon slot="icon"
            >delete_forever</oscd-icon
          ></oscd-text-button
        >
        <oscd-text-button class="close" @click=${() => this.dialog.close()}
          >${msg('Close')}</oscd-text-button
        >
      </div>`;
  }

  render(): TemplateResult {
    const { connection } = this;
    return html`<oscd-dialog
      .open=${connection !== undefined}
      @closed=${this.handleClosed}
    >
      ${connection ? this.renderContent(connection) : nothing}
    </oscd-dialog>`;
  }

  static styles = css`
    oscd-dialog {
      width: min(calc(100vw - 48px), 1100px);
      max-width: min(calc(100vw - 48px), 1100px);
      max-height: calc(100vh - 48px);
      --md-dialog-headline-size: 1.5rem;
      --md-dialog-supporting-text-size: 1rem;
      --md-dialog-supporting-text-line-height: 1.5rem;
    }

    .content {
      font-size: 1rem;
      color: var(--oscd-base00);
    }

    .headline {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .supervision {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 8px;
    }

    details {
      margin-bottom: 12px;
      border: 1px solid var(--oscd-base2);
      border-radius: var(--oscd-shape, 4px);
    }

    /* A full width row with a chevron: clearly something to open. */
    summary {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px 8px 8px;
      cursor: pointer;
      list-style: none;
      border-radius: var(--oscd-shape, 4px);
    }

    summary::-webkit-details-marker {
      display: none;
    }

    summary:hover {
      background: var(--oscd-base2);
    }

    summary:focus-visible {
      outline: 2px solid var(--oscd-primary);
      outline-offset: -2px;
    }

    .chevron {
      flex: none;
      transition: transform 0.15s;
    }

    details[open] .chevron {
      transform: rotate(90deg);
    }

    .summary-title {
      flex: none;
      font-weight: 500;
    }

    .preview {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--oscd-base01);
      font-size: 0.9em;
    }

    details .details {
      margin: 0 12px 8px 32px;
    }

    .details {
      width: auto;
    }

    table {
      border-collapse: collapse;
      width: 100%;
    }

    th,
    td {
      padding: 6px 12px;
      text-align: left;
      vertical-align: top;
    }

    .details th {
      font-weight: 500;
      white-space: nowrap;
    }

    .inputs thead th {
      border-bottom: 1px solid var(--oscd-base1);
      font-weight: 500;
    }

    .inputs tbody tr:nth-child(even) {
      background: var(--oscd-base2);
    }

    .reference {
      display: block;
      font-family: var(--oscd-text-font-mono);
      font-size: 0.95em;
      color: var(--oscd-base02);
      word-break: break-all;
    }

    .desc {
      display: block;
      font-size: 0.9em;
      color: var(--oscd-base01);
    }

    .quality {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 8px;
    }

    .remove-all {
      --md-text-button-label-text-color: var(--oscd-error);
      --md-text-button-icon-color: var(--oscd-error);
    }

    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
    }
  `;
}
