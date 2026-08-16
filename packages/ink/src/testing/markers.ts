/**
 * Marker extraction for tests: find the render-commit sequences in a captured
 * stream, verify them, and report where in the stream they sat.
 *
 * Position is the interesting part — the adapter's core promise is that the
 * marker for revision N follows the last byte of revision N's frame.
 */

import { MARKER_OSC_CODE, MARKER_OSC_PREFIX, verifyMarkerPayload } from '@termwright/protocol';

/**
 * `OSC 8487 ; twm;<revision>;<mac>` with its terminator; the payload is
 * captured, which is exactly what a VT parser hands an OSC handler.
 *
 * Both terminators are accepted. The adapter emits BEL — the one ConPTY was
 * measured to forward most reliably — but the protocol lets a receiver see
 * either, and a matcher that knew only one would start passing for the wrong
 * reason the day that changed.
 */
function markerPattern(): RegExp {
  return new RegExp(
    `\\u001b\\]${MARKER_OSC_CODE};(${MARKER_OSC_PREFIX}[^\\u0007\\u001b]*)(?:\\u0007|\\u001b\\\\)`,
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

/**
 * Wait until `count` verified markers are present in a stream.
 *
 * The marker for a revision is written *after* its snapshot has been pushed and
 * after stdout has drained, so a test that waited on the snapshot and then read
 * the stream once is asserting on an effect that has not happened yet. It
 * survives on a transport that coalesces writes and fails where one does not.
 *
 * @param read - Returns the stream contents as captured so far.
 */
export async function waitForMarkers(
  read: () => string,
  token: string,
  sessionId: string,
  count: number,
  timeoutMs = 5_000,
): Promise<FoundMarker[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = markersIn(read(), token, sessionId);
    if (found.length >= count) return found;
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${count} marker(s); saw ${found.length}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** The stream with every marker sequence removed, for byte-identity comparisons. */
export function stripMarkers(output: string): string {
  return output.replaceAll(markerPattern(), '');
}
