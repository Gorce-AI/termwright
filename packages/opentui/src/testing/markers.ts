/**
 * Marker extraction for tests: find the render-commit sequences in a captured
 * stream, verify them, and report where in the stream they sat.
 *
 * Position is the interesting part — the adapter's core promise is that the
 * marker for revision N follows the last byte of revision N's frame.
 */

import { MARKER_OSC_CODE, MARKER_OSC_PREFIX, verifyMarkerPayload } from '@termwright/protocol';

/**
 * `ESC ] 8487 ; twm;<revision>;<mac>` followed by a terminator, with the
 * payload captured.
 *
 * **Both OSC terminators are accepted.** `encodeMarker` writes BEL, but a
 * terminal, a multiplexer or ConPTY may hand back the ST form (`ESC \`), and a
 * scanner that only knew one of them would silently report "no markers" on a
 * stream that carries them — the least useful way for this to fail.
 *
 * The payload class excludes both BEL and ESC, so a sequence that never
 * terminates cannot swallow the rest of the stream.
 */
function markerPattern(): RegExp {
  return new RegExp(
    `\\u001b\\]${String(MARKER_OSC_CODE)};(${MARKER_OSC_PREFIX}[^\\u0007\\u001b]*)(?:\\u0007|\\u001b\\\\)`,
    'gu',
  );
}

/** One verified marker and its byte offset in the stream. */
export interface FoundMarker {
  readonly index: number;
  readonly revision: number;
}

/**
 * All markers in a stream that authenticate against the session, in order.
 *
 * Unverifiable sequences are dropped rather than reported: a marker that fails
 * its MAC is, by design, indistinguishable from application output.
 */
export function markersIn(output: string, token: string, sessionId: string): FoundMarker[] {
  const found: FoundMarker[] = [];
  for (const match of output.matchAll(markerPattern())) {
    const marker = verifyMarkerPayload(match[1] as string, token, sessionId);
    if (marker !== null) found.push({ index: match.index, revision: marker.revision });
  }
  return found;
}

/** The stream with every marker sequence removed, for byte-identity comparisons. */
export function stripMarkers(output: string): string {
  return output.replaceAll(markerPattern(), '');
}
