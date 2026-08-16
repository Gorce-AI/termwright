/**
 * `@termwright/recognizers` — the rules that turn observed facts into meaning.
 *
 * A probe reports what a framework exposed; a recognizer decides what it is.
 * Everything here is a pure function over Probe IR, so the rules can be tested
 * without a process, a framework or a socket — and so the same rules apply to
 * every framework instead of being reinvented per adapter.
 */

export { recognize } from './recognize.js';
export type { RecognizeContext } from './recognize.js';
export { namesFromContent, normalizeName, NAME_FROM_CONTENT } from './naming.js';
export { roleForOpenTuiClass, isOpenTuiClass } from './opentui.js';
