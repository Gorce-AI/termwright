/**
 * The two things a terminal app needs before a test can click it: mouse
 * reporting turned on, and a way to tell which widget a report landed in.
 *
 * Neither is termwright's job. A driver that finds mouse reporting disabled
 * refuses `click()` with `unsupported-action` instead of sending bytes nothing
 * will read, so this file is the application half of that contract.
 */

import { useEffect } from 'react';
import { measureElement, useStdout, type DOMElement } from 'ink';

/** Zero-based viewport coordinates of a mouse report. */
export interface Point {
  readonly row: number;
  readonly column: number;
}

/**
 * An SGR mouse report as Ink hands it to `useInput`: the leading ESC has
 * already been stripped from sequences its key parser did not recognise, so
 * both forms have to be accepted.
 */
const SGR_MOUSE = /\u001B?\[<(\d+);(\d+);(\d+)([Mm])/u;

/**
 * True for any mouse report — press, release, drag or wheel.
 *
 * Worth having separately from {@link parseMousePress}: a handler that only
 * recognises presses and lets everything else fall through to its text branch
 * types the release report into the focused field.
 */
export function isMouseReport(input: string): boolean {
  return SGR_MOUSE.test(input);
}

/** Left-button press coordinates, or `null` for anything else. */
export function parseMousePress(input: string): Point | null {
  const match = SGR_MOUSE.exec(input);
  if (match === null) return null;
  if (match[4] !== 'M') return null; // a release, not a press
  if (Number(match[1]) !== 0) return null; // middle, right, wheel or drag
  return { column: Number(match[2]) - 1, row: Number(match[3]) - 1 };
}

/** True when `point` falls inside the element's measured box. */
export function hits(element: DOMElement | null, point: Point): boolean {
  if (element === null) return false;
  const box = measureElement(element);
  return (
    point.column >= box.x &&
    point.column < box.x + box.width &&
    point.row >= box.y &&
    point.row < box.y + box.height
  );
}

/**
 * How many mounted components currently want mouse reporting.
 *
 * Mouse tracking is a terminal mode, not component state: two components that
 * each turn it on and off independently leave it off as soon as the first one
 * unmounts — which is what a modal dialog does when it closes, and it takes
 * the rest of the app's clicks with it.
 */
let subscribers = 0;

/**
 * Enables SGR mouse reporting for as long as any component wants it.
 *
 * Writing through Ink's own stdout rather than `process.stdout` is what keeps
 * this working in a component test, where the component is rendered into a
 * harness stream instead of a terminal.
 */
export function useMouseReporting(): void {
  const { stdout } = useStdout();

  useEffect(() => {
    subscribers += 1;
    if (subscribers === 1) stdout.write('\u001B[?1000h\u001B[?1006h');
    return () => {
      subscribers -= 1;
      if (subscribers === 0) stdout.write('\u001B[?1006l\u001B[?1000l');
    };
  }, [stdout]);
}
