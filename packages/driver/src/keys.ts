/**
 * Keyboard encoder: Playwright-style key descriptions to the bytes a real
 * terminal would deliver on stdin.
 *
 * A description is a whitespace-separated sequence of chords; each chord is
 * `Modifier+…+Key`, e.g. `Control+A`, `Shift+Tab`, `Alt+ArrowLeft`,
 * `Control+K Control+U`. Cursor and function keys honor DECCKM (application
 * cursor keys), so the same description produces different bytes depending on
 * what the child program asked for.
 */
import { UnsupportedActionError } from './errors.js';

const ESC = '\x1b';
const CSI = `${ESC}[`;
const SS3 = `${ESC}O`;

/** Emulator state the encoder must honor. */
export interface KeyEncodingModes {
  readonly applicationCursorKeys: boolean;
  readonly applicationKeypad: boolean;
}

interface Modifiers {
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
}

/** Cursor-style keys: `CSI <final>` normally, `SS3 <final>` in application mode. */
const CURSOR_KEYS: Readonly<Record<string, string>> = Object.freeze({
  arrowup: 'A',
  arrowdown: 'B',
  arrowright: 'C',
  arrowleft: 'D',
  home: 'H',
  end: 'F',
});

/** Keys encoded as `CSI <number> ~`. */
const TILDE_KEYS: Readonly<Record<string, number>> = Object.freeze({
  insert: 2,
  delete: 3,
  pageup: 5,
  pagedown: 6,
  f5: 15,
  f6: 17,
  f7: 18,
  f8: 19,
  f9: 20,
  f10: 21,
  f11: 23,
  f12: 24,
});

/** F1–F4 are `SS3 <final>` without modifiers, `CSI 1;<mod> <final>` with them. */
const SS3_FUNCTION_KEYS: Readonly<Record<string, string>> = Object.freeze({
  f1: 'P',
  f2: 'Q',
  f3: 'R',
  f4: 'S',
});

/** Keys that are a single control byte. */
const LITERAL_KEYS: Readonly<Record<string, string>> = Object.freeze({
  enter: '\r',
  return: '\r',
  tab: '\t',
  escape: ESC,
  esc: ESC,
  backspace: '\x7f',
  space: ' ',
});

const MODIFIER_ALIASES: Readonly<Record<string, keyof Modifiers>> = Object.freeze({
  control: 'ctrl',
  ctrl: 'ctrl',
  shift: 'shift',
  alt: 'alt',
  option: 'alt',
  // No terminal encodes Meta separately; it is delivered as ESC-prefix like Alt.
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
});

function modifierParameter(mods: Modifiers): number {
  return 1 + (mods.shift ? 1 : 0) + (mods.alt || mods.meta ? 2 : 0) + (mods.ctrl ? 4 : 0);
}

function unsupported(key: string, detail: string): never {
  throw new UnsupportedActionError(`cannot encode key ${JSON.stringify(key)}: ${detail}`, {
    semanticTree: false,
    suggestion:
      'use a single character, or one of Enter, Escape, Tab, Backspace, Delete, Insert, Space, ' +
      'Arrow{Up,Down,Left,Right}, Home, End, PageUp, PageDown, F1–F12, optionally prefixed with ' +
      'Control+/Shift+/Alt+',
  });
}

function parseChord(chord: string): { key: string; mods: Modifiers } {
  const mods: Modifiers = { shift: false, alt: false, ctrl: false, meta: false };
  let rest = chord;
  for (;;) {
    const plus = rest.indexOf('+');
    // A trailing '+' is the key itself ('Control++').
    if (plus <= 0 || plus === rest.length - 1) break;
    const candidate = MODIFIER_ALIASES[rest.slice(0, plus).toLowerCase()];
    if (candidate === undefined) break;
    mods[candidate] = true;
    rest = rest.slice(plus + 1);
  }
  if (rest.length === 0) unsupported(chord, 'empty key');
  return { key: rest, mods };
}

function encodeControlChar(key: string, mods: Modifiers): string | undefined {
  if (!mods.ctrl) return undefined;
  if (key.length !== 1) return undefined;
  const upper = key.toUpperCase();
  const code = upper.codePointAt(0);
  if (code === undefined) return undefined;
  if (code >= 0x41 && code <= 0x5a) return String.fromCharCode(code & 0x1f);
  switch (key) {
    case ' ':
    case '@':
      return '\x00';
    case '[':
      return ESC;
    case '\\':
      return '\x1c';
    case ']':
      return '\x1d';
    case '^':
      return '\x1e';
    case '_':
      return '\x1f';
    case '?':
      return '\x7f';
    default:
      return undefined;
  }
}

function encodeChord(chord: string, modes: KeyEncodingModes): string {
  const { key, mods } = parseChord(chord);
  const lower = key.toLowerCase();
  const param = modifierParameter(mods);
  const modified = param !== 1;

  const cursorFinal = CURSOR_KEYS[lower];
  if (cursorFinal !== undefined) {
    if (modified) return `${CSI}1;${param}${cursorFinal}`;
    return modes.applicationCursorKeys ? `${SS3}${cursorFinal}` : `${CSI}${cursorFinal}`;
  }

  const tilde = TILDE_KEYS[lower];
  if (tilde !== undefined) {
    return modified ? `${CSI}${tilde};${param}~` : `${CSI}${tilde}~`;
  }

  const ss3Final = SS3_FUNCTION_KEYS[lower];
  if (ss3Final !== undefined) {
    return modified ? `${CSI}1;${param}${ss3Final}` : `${SS3}${ss3Final}`;
  }

  if (lower === 'tab' && mods.shift) return `${CSI}Z`;

  const literal = LITERAL_KEYS[lower];
  if (literal !== undefined) {
    if (lower === 'backspace' && mods.ctrl) return '\x08';
    const ctrlLiteral = encodeControlChar(literal, mods);
    const base = ctrlLiteral ?? literal;
    return mods.alt || mods.meta ? `${ESC}${base}` : base;
  }

  if ([...key].length !== 1) unsupported(key, 'unknown key name');

  const control = encodeControlChar(key, mods);
  if (control !== undefined) return mods.alt || mods.meta ? `${ESC}${control}` : control;
  if (mods.ctrl) unsupported(key, 'no control encoding exists for this character');

  const base = mods.shift ? key.toUpperCase() : key;
  return mods.alt || mods.meta ? `${ESC}${base}` : base;
}

/**
 * Encodes a key description into the bytes a terminal would send.
 *
 * @param keys - one or more chords, e.g. `'Control+A'` or `'Escape ArrowUp'`
 * @param modes - the child's current DECCKM/DECNKM state
 */
export function encodeKeys(keys: string, modes: KeyEncodingModes): Uint8Array {
  const chords = keys.split(/\s+/u).filter((chord) => chord.length > 0);
  if (chords.length === 0) unsupported(keys, 'no chords given');
  const text = chords.map((chord) => encodeChord(chord, modes)).join('');
  return new TextEncoder().encode(text);
}

/**
 * Encodes literal text as typed input: `\n` becomes carriage return, which is
 * what a terminal delivers when the Enter key is pressed.
 */
export function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text.replace(/\r\n|\n/gu, '\r'));
}

/** Bracketed-paste wrapper (`CSI 200~ … CSI 201~`), used only when the child enabled it. */
export function encodePaste(text: string, bracketed: boolean): Uint8Array {
  const body = text.replace(/\r\n|\n/gu, '\r');
  const payload = bracketed ? `${CSI}200~${body}${CSI}201~` : body;
  return new TextEncoder().encode(payload);
}

/** Focus in/out reports (`CSI I` / `CSI O`), sent only when the child enabled 1004. */
export function encodeFocus(focused: boolean): Uint8Array {
  return new TextEncoder().encode(focused ? `${CSI}I` : `${CSI}O`);
}
