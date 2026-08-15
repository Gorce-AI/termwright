/**
 * Marker extraction for tests: find the DCS render-commit sequences in a
 * captured stream, verify them, and report where in the stream they sat.
 *
 * Position is the interesting part — the adapter's core promise is that the
 * marker for revision N follows the last byte of revision N's frame.
 */

import { verifyMarkerPayload } from '@termwright/protocol';

/** `ESC P twm;<revision>;<mac> ESC \` — the payload is captured. */
const MARKER_PATTERN = /\u001bP(twm;[^\u001b]*)\u001b\\/gu;

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
  for (const match of output.matchAll(MARKER_PATTERN)) {
    const marker = verifyMarkerPayload(match[1] as string, token, sessionId);
    if (marker !== null) found.push({ index: match.index, revision: marker.revision });
  }
  return found;
}

/** The stream with every marker sequence removed, for byte-identity comparisons. */
export function stripMarkers(output: string): string {
  return output.replaceAll(MARKER_PATTERN, '');
}
