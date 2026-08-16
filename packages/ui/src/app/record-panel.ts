/**
 * Recording a session from the panel: what to record, that it is recording,
 * and what it wrote.
 *
 * The recorder existed before this as a command-line flag, which meant it
 * existed for people who already knew it existed. Here it is a thing you can
 * see: a button beside the specs, a state you cannot miss while it is on, and
 * a test you read before deciding to keep it.
 */

import { html, type TemplateResult } from 'lit-html';

/** The form that starts a recording. */
export interface RecordFormModel {
  /** Command prefilled from the project's configuration, when there is one. */
  readonly command: string;
  readonly outFile: string;
  /** Present when the last attempt failed, so the form can say why. */
  readonly error: string | null;
  readonly busy: boolean;
}

export interface RecordFormHandlers {
  setCommand(command: string): void;
  setOutFile(file: string): void;
  start(): void;
  cancel(): void;
}

/** Renders the "record a session" dialog. */
export function renderRecordForm(
  model: RecordFormModel,
  handlers: RecordFormHandlers,
): TemplateResult {
  return html`
    <div class="dialog" role="dialog" aria-label="Record a session" data-testid="record-form">
      <h2>Record a session</h2>
      <p class="muted">
        termwright drives the program you name, writes down what you do, and turns it into a test.
        Nothing is written to disk until you say so.
      </p>

      <label>
        Command
        <input
          data-testid="record-command"
          .value=${model.command}
          placeholder="node app.js"
          @input=${(event: Event) => handlers.setCommand((event.target as HTMLInputElement).value)}
        />
      </label>

      <label>
        Write to
        <input
          data-testid="record-out"
          .value=${model.outFile}
          placeholder="src/recorded.test.ts"
          @input=${(event: Event) => handlers.setOutFile((event.target as HTMLInputElement).value)}
        />
      </label>

      ${model.error === null ? '' : html`<p class="warn" data-testid="record-error">${model.error}</p>`}

      <div class="dialog-actions">
        <button @click=${() => handlers.cancel()}>Cancel</button>
        <button
          class="primary"
          data-testid="record-start"
          ?disabled=${model.busy || model.command.trim() === ''}
          @click=${() => handlers.start()}
        >
          ${model.busy ? 'Starting…' : 'Start recording'}
        </button>
      </div>
    </div>
  `;
}

/** The test a finished recording produced. */
export interface RecordResultModel {
  readonly source: string;
  readonly outFile: string;
  /** What happened to it, once something has. */
  readonly note: string | null;
}

export interface RecordResultHandlers {
  save(): void;
  copy(): void;
  discard(): void;
}

/** Renders the generated test, before anything is done with it. */
export function renderRecordResult(
  model: RecordResultModel,
  handlers: RecordResultHandlers,
): TemplateResult {
  return html`
    <div class="dialog wide" role="dialog" aria-label="Recorded test" data-testid="record-result">
      <h2>What the recording wrote</h2>
      <pre class="source" data-testid="record-source">${model.source}</pre>
      ${model.note === null ? '' : html`<p class="muted" data-testid="record-note">${model.note}</p>`}
      <div class="dialog-actions">
        <button data-testid="record-discard" @click=${() => handlers.discard()}>Discard</button>
        <button data-testid="record-copy" @click=${() => handlers.copy()}>Copy</button>
        <button class="primary" data-testid="record-save" @click=${() => handlers.save()}>
          Save to ${model.outFile === '' ? 'a file…' : model.outFile}
        </button>
      </div>
    </div>
  `;
}

/** The state of a recording, for the frame to show from any view. */
export function renderRecordingBadge(): TemplateResult {
  // Not colour alone: a dot that means "recording" and nothing else is a dot
  // people learn to ignore, and one that only differs by hue is invisible to
  // some of them entirely.
  return html`<span class="rec" data-testid="recording" title="A session is being recorded">
    <span class="rec-dot" aria-hidden="true"></span>REC
  </span>`;
}
