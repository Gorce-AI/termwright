/**
 * Mouse encoder. Clicks, drags and wheel events are delivered as the byte
 * sequences a real terminal emits, in whatever encoding the child program
 * negotiated. SGR (`CSI ? 1006 h`) is preferred because it is the only encoding
 * that survives coordinates beyond column/row 223.
 *
 * If the child never enabled mouse tracking there is nothing to send: the
 * driver reports a typed `input-mode-disabled` instead of inventing input.
 *
 * When the backend cannot observe the mode (`'unknown'`, for example on some
 * ConPTY configurations), Termwright fails closed. It never guesses SGR or a
 * tracking level merely because those bytes might happen to work.
 */
import type { TerminalModes } from './api.js';
import { CapabilityUnavailableError, InputModeDisabledError } from './errors.js';

const ESC = '\x1b';
const CSI = `${ESC}[`;

/** Mouse buttons the driver can deliver. */
export type MouseButton = 'left' | 'middle' | 'right';

/** One mouse event in viewport cell coordinates (zero-based). */
export interface MouseEvent {
  readonly kind: 'press' | 'release' | 'move' | 'wheel';
  readonly row: number;
  readonly column: number;
  readonly button?: MouseButton;
  readonly modifiers?: readonly ('shift' | 'alt' | 'control')[];
  /** Wheel direction; positive scrolls down, negative scrolls up. */
  readonly wheelDelta?: number;
  readonly wheelAxis?: 'vertical' | 'horizontal';
  /** True while a button is held (motion events use the drag bit). */
  readonly dragging?: boolean;
}

const BUTTON_CODES: Readonly<Record<MouseButton, number>> = Object.freeze({
  left: 0,
  middle: 1,
  right: 2,
});

const MODIFIER_ORDER = Object.freeze(['shift', 'alt', 'control'] as const);

/** Validates and canonicalises mouse modifier bits for plans and receipts. */
export function normalizeMouseModifiers(
  values: readonly string[] | undefined,
): readonly ('shift' | 'alt' | 'control')[] {
  const provided = new Set(values ?? []);
  for (const value of provided) {
    if (!(MODIFIER_ORDER as readonly string[]).includes(value)) {
      throw new TypeError(`unknown mouse modifier ${JSON.stringify(value)}`);
    }
  }
  return Object.freeze(MODIFIER_ORDER.filter((value) => provided.has(value)));
}

/** Largest coordinate the legacy X10 encoding can express (32 + 223 = 255). */
const X10_MAX_COORDINATE = 223;

function buttonCode(event: MouseEvent): number {
  const modifiers = new Set(normalizeMouseModifiers(event.modifiers));
  const modifierBits =
    (modifiers.has('shift') ? 4 : 0) +
    (modifiers.has('alt') ? 8 : 0) +
    (modifiers.has('control') ? 16 : 0);
  switch (event.kind) {
    case 'wheel': {
      const delta = event.wheelDelta ?? 0;
      if (event.wheelAxis === 'horizontal') return (delta < 0 ? 66 : 67) + modifierBits;
      return (delta < 0 ? 64 : 65) + modifierBits;
    }
    case 'move':
      return (event.button === undefined ? 3 : BUTTON_CODES[event.button]) + 32 + modifierBits;
    default:
      return BUTTON_CODES[event.button ?? 'left'] + modifierBits;
  }
}

/**
 * True when the platform hid the child's mouse mode, so neither a refusal nor
 * an encoding choice can be made from what was observed.
 */
export function mouseModeUnverifiable(modes: TerminalModes): boolean {
  return modes.mouseTracking === 'unknown' || modes.mouseEncoding === 'unknown';
}

function unsupported(message: string, suggestion: string): never {
  throw new InputModeDisabledError(message, { semanticTree: false, suggestion });
}

/**
 * Encodes one mouse event.
 *
 * @param event - the event in zero-based viewport coordinates
 * @param modes - current tracking/encoding modes as observed on the wire
 * @throws InputModeDisabledError when the child has no mouse tracking enabled,
 * or when the coordinates cannot be expressed in the negotiated encoding.
 */
export function encodeMouse(event: MouseEvent, modes: TerminalModes): Uint8Array {
  if (mouseModeUnverifiable(modes)) {
    unsupported(
      'the terminal mouse mode is not observable, so Termwright cannot choose a protocol authoritatively',
      'use a PTY backend that exposes DEC mouse modes; Termwright does not guess SGR input',
    );
  }
  if (modes.mouseTracking === 'none') {
    unsupported(
      'the child program has not enabled mouse tracking, so a mouse event cannot be delivered',
      'drive the widget with press()/keyboard locators, or enable mouse mode in the application under test',
    );
  }
  if (modes.mouseTracking === 'x10' && event.kind !== 'press') {
    unsupported(
      `mouse tracking mode 'x10' reports button presses only, so a ${event.kind} event cannot be delivered`,
      'the application under test must enable CSI ? 1000 h or higher for release and motion events',
    );
  }
  if (event.kind === 'move' && modes.mouseTracking !== 'drag' && modes.mouseTracking !== 'any') {
    unsupported(
      `mouse tracking mode ${JSON.stringify(modes.mouseTracking)} does not report motion`,
      'the application under test must enable CSI ? 1002 h (drag) or CSI ? 1003 h (any motion)',
    );
  }

  const code = buttonCode(event);
  const column = event.column + 1;
  const row = event.row + 1;

  switch (modes.mouseEncoding) {
    case 'sgr': {
      const final = event.kind === 'release' ? 'm' : 'M';
      return encode(`${CSI}<${code};${column};${row}${final}`);
    }
    case 'urxvt': {
      const code2 = event.kind === 'release' ? 3 : code;
      return encode(`${CSI}${code2 + 32};${column};${row}M`);
    }
    case 'utf8': {
      const code2 = event.kind === 'release' ? 3 : code;
      return encode(`${CSI}M${String.fromCodePoint(32 + code2, 32 + column, 32 + row)}`);
    }
    case 'default': {
      if (column > X10_MAX_COORDINATE || row > X10_MAX_COORDINATE) {
        unsupported(
          `cell (${event.row}, ${event.column}) is outside the range the legacy mouse encoding can express`,
          'the application under test should enable SGR mouse reporting (CSI ? 1006 h)',
        );
      }
      const code2 = event.kind === 'release' ? 3 : code;
      // Legacy encoding is byte-based, not text-based: one byte per field.
      return Uint8Array.from([0x1b, 0x5b, 0x4d, 32 + code2, 32 + column, 32 + row]);
    }
    default:
      throw new CapabilityUnavailableError(
        `unknown mouse encoding ${JSON.stringify(modes.mouseEncoding)}`,
        {
          semanticTree: false,
          suggestion: 'file a bug: the driver observed a mouse encoding it does not implement',
        },
      );
  }
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Concatenates several encoded events into one write. */
export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
