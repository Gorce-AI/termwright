import { Copy, Save, Trash2, X } from 'lucide-react';
import { useEffect, useRef, type RefObject } from 'react';
import { Tooltip } from './Tooltip.js';

export interface RecorderDraft {
  readonly command: string;
  readonly outFile: string;
  readonly error: string | null;
  readonly busy: boolean;
}

export function RecordStartDialog({ draft, onChange, onStart, onClose }: {
  readonly draft: RecorderDraft;
  readonly onChange: (draft: RecorderDraft) => void;
  readonly onStart: () => void;
  readonly onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const initial = useRef<HTMLInputElement>(null);
  useModalFocus(dialog, initial, onClose, draft.busy);
  return (
    <div className="tw-dialog-backdrop" role="presentation">
      <section ref={dialog} className="tw-dialog" role="dialog" aria-modal="true" aria-labelledby="tw-record-title">
        <header><div><span className="tw-eyebrow">interactive authoring</span><h2 id="tw-record-title">Record a terminal test</h2></div><Tooltip label="Close recorder" disabledReason="Wait for the recorder to finish launching."><button type="button" className="tw-dialog-close" aria-label="Close recorder" disabled={draft.busy} onClick={onClose}><X aria-hidden="true" /></button></Tooltip></header>
        <p>Launch a command without a shell. Termwright captures typing and semantic actions, then lets you review the generated test before anything is saved.</p>
        <label>Command<input ref={initial} value={draft.command} aria-invalid={draft.error !== null} onChange={(event) => onChange({ ...draft, command: event.currentTarget.value, error: null })} placeholder={'node "app with spaces.js"'} /></label>
        <label>Save destination<input value={draft.outFile} onChange={(event) => onChange({ ...draft, outFile: event.currentTarget.value })} placeholder="tests/recorded.test.ts" /></label>
        {draft.error === null ? null : <p className="tw-dialog-error" role="alert">{draft.error}</p>}
        <footer><button type="button" className="tw-secondary-button" disabled={draft.busy} onClick={onClose}>Cancel</button><button type="button" className="tw-primary-button" disabled={draft.busy || draft.command.trim() === ''} onClick={onStart}>{draft.busy ? 'Launching…' : 'Start recording'}</button></footer>
      </section>
    </div>
  );
}

export function RecordReviewDialog({ source, outFile, error, busy, onSave, onCopy, onDiscard }: {
  readonly source: string;
  readonly outFile: string;
  readonly error: string | null;
  readonly busy: boolean;
  readonly onSave: () => void;
  readonly onCopy: () => void;
  readonly onDiscard: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const initial = useRef<HTMLButtonElement>(null);
  useModalFocus(dialog, initial, onDiscard, busy);
  return (
    <div className="tw-dialog-backdrop" role="presentation">
      <section ref={dialog} className="tw-dialog tw-dialog-wide" role="dialog" aria-modal="true" aria-labelledby="tw-review-title">
        <header><div><span className="tw-eyebrow">review before writing</span><h2 id="tw-review-title">Generated test</h2></div><span className="tw-rec-badge"><i /> REC complete</span></header>
        <pre className="tw-generated-source"><code>{source}</code></pre>
        {error === null ? null : <p className="tw-dialog-error" role="alert">{error}</p>}
        <footer>
          <button type="button" className="tw-secondary-button" disabled={busy} onClick={onDiscard}><Trash2 aria-hidden="true" size={14} /> Discard</button>
          <button type="button" className="tw-secondary-button" disabled={busy} onClick={onCopy}><Copy aria-hidden="true" size={14} /> Copy</button>
          <button ref={initial} type="button" className="tw-primary-button" disabled={busy} onClick={onSave}><Save aria-hidden="true" size={14} /> {busy ? 'Saving…' : `Save${outFile === '' ? '…' : ` to ${outFile}`}`}</button>
        </footer>
      </section>
    </div>
  );
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** Keeps keyboard focus inside a recorder decision and restores it afterward. */
function useModalFocus(
  container: RefObject<HTMLElement | null>,
  initial: RefObject<HTMLElement | null>,
  onEscape: () => void,
  escapeDisabled: boolean,
): void {
  const escape = useRef(onEscape);
  const disabled = useRef(escapeDisabled);
  escape.current = onEscape;
  disabled.current = escapeDisabled;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    initial.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (disabled.current) return;
        event.preventDefault();
        escape.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(container.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
        .filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [container, initial]);
}
