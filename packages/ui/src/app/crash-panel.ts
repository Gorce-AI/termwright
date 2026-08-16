/**
 * The crash panel: how the recorded program died, and what the terminal showed
 * as it went.
 *
 * It mirrors the crash section of the HTML report in `@termwright/trace` — same
 * order, same warning above the screen tail — so the two views of one archive
 * read as one artefact rather than two summaries that have to be reconciled.
 */

import { html, type TemplateResult } from 'lit-html';
import { CRASH_TAIL_WARNING, type CrashView } from '../crash.js';
import { formatMs } from '../view-model.js';

/** What the panel can ask the app to do. */
export interface CrashPanelHandlers {
  /** Move the terminal and the inspector to the moment of the crash. */
  seek(timeMs: number): void;
}

/**
 * Renders the crash panel, or nothing when the archive has no usable crash
 * section. Open by default: a run that died on its own is the reason the
 * archive was opened.
 */
export function renderCrashPanel(
  crash: CrashView | null,
  handlers: CrashPanelHandlers,
): TemplateResult | '' {
  if (crash === null) return '';
  return html`
    <details class="crash" data-testid="crash" open>
      <summary>
        <span class="dot failed"></span>
        <span class="crash-cause">The program died on its own: <strong>${crash.cause}</strong></span>
        <button
          data-testid="crash-seek"
          @click=${(event: Event) => {
            event.preventDefault();
            handlers.seek(crash.castOffset);
          }}
        >
          Go to ${formatMs(crash.castOffset)}
        </button>
      </summary>

      ${crash.screenTail.length === 0
        ? ''
        : html`
            <h4>Screen at the end</h4>
            <p class="warn" data-testid="crash-warning">${CRASH_TAIL_WARNING}</p>
            ${crash.screenTailTruncated
              ? html`<p class="muted">Older rows omitted; the full tail is in the archive.</p>`
              : ''}
            <pre class="crash-screen" data-testid="crash-screen">${crash.screenTail.join('\n')}</pre>
          `}

      ${crash.recentInputs.length === 0
        ? ''
        : html`
            <h4>Last inputs before the end</h4>
            <table class="crash-inputs" data-testid="crash-inputs">
              <thead>
                <tr><th>at</th><th>kind</th><th>size</th><th>sent</th></tr>
              </thead>
              <tbody>
                ${crash.recentInputs.map(
                  (input) => html`
                    <tr>
                      <td>${formatMs(input.timeMs)}</td>
                      <td>${input.kind}</td>
                      <td>${input.bytes} B</td>
                      <td>
                        ${input.preview === undefined
                          ? html`<span class="muted">not recorded</span>`
                          : html`<code>${input.preview}</code>`}
                      </td>
                    </tr>
                  `,
                )}
              </tbody>
            </table>
          `}

      ${crash.diagnosticsTail.length === 0
        ? ''
        : html`
            <h4>Session diagnostics</h4>
            <ul class="crash-diagnostics">
              ${crash.diagnosticsTail.map(
                (entry) => html`
                  <li>
                    <code>${entry.code}</code> ${entry.detail}
                    ${entry.revision === undefined
                      ? ''
                      : html`<span class="muted">rev ${entry.revision}</span>`}
                  </li>
                `,
              )}
            </ul>
          `}

      ${crash.lastSemanticRevision === null
        ? ''
        : html`<p class="muted">
            Last semantic revision: ${crash.lastSemanticRevision} — the inspector shows it once you
            jump to the crash.
          </p>`}
    </details>
  `;
}
