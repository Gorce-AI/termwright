/**
 * One mapping between a moment and a place on the timeline.
 *
 * The scrubber, the markers under it and every click on either must agree about
 * where 815 ms is. When they did not — a native `<input type=range>` whose thumb
 * travels `width − thumbWidth`, next to a separately positioned marker strip
 * with its own margins — the error was zero on the left and grew with every
 * step right, which is the most convincing kind of wrong: it looks fine until
 * you check the end.
 *
 * So there is one function each way, used by everything: {@link fractionFor}
 * places a time, {@link timeAt} reads a pointer back. Anything that needs a
 * position must go through here.
 *
 * @packageDocumentation
 */

/**
 * Where a moment sits on the track, as a fraction of its width.
 *
 * @returns 0..1, clamped. A zero-length recording puts everything at the start
 * rather than dividing by zero.
 */
export function fractionFor(timeMs: number, durationMs: number): number {
  if (!Number.isFinite(timeMs) || !Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.min(Math.max(timeMs / durationMs, 0), 1);
}

/** The same fraction as a CSS percentage, for `left` and `width`. */
export function percentFor(timeMs: number, durationMs: number): string {
  return `${fractionFor(timeMs, durationMs) * 100}%`;
}

/**
 * The moment a pointer is over.
 *
 * @param clientX - pointer position, in client coordinates.
 * @param track - the track's bounding box; the *same* element the positions are
 * measured against, which is what keeps the two directions consistent.
 */
export function timeAt(clientX: number, track: { left: number; width: number }, durationMs: number): number {
  if (track.width <= 0 || durationMs <= 0) return 0;
  const fraction = Math.min(Math.max((clientX - track.left) / track.width, 0), 1);
  return fraction * durationMs;
}
