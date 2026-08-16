/**
 * The marker extractor these tests' own assertions depend on.
 *
 * `adapter.test.ts` proves the adapter writes a marker after the frame it
 * commits, and it proves it *through* `markersIn`. A scanner that quietly
 * matched nothing would turn those assertions green by vacuity, so the scanner
 * is pinned here against the protocol's real encoder rather than against a
 * hand-written string.
 */
import { describe, expect, it } from 'vitest';
import { encodeMarker, generateToken, MARKER_OSC_CODE } from '@termwright/protocol';
import { markersIn, stripMarkers } from './markers.js';

const TOKEN = generateToken();
const SESSION = 's1';

/** The same marker with its BEL terminator swapped for the ST form. */
function withStTerminator(marker: string): string {
  return `${marker.slice(0, -1)}\u001b\\`;
}

describe('markersIn', () => {
  it('finds a marker the protocol encoded, and reads its revision', () => {
    const output = `frame bytes${encodeMarker(TOKEN, SESSION, 7)}`;

    expect(markersIn(output, TOKEN, SESSION)).toEqual([
      { index: 'frame bytes'.length, revision: 7 },
    ]);
  });

  it('accepts the ST terminator as well as BEL', () => {
    // encodeMarker writes BEL, but a terminal, a multiplexer or ConPTY may hand
    // back the ST form, and a scanner that knew only one would report an empty
    // stream as confidently as a correct one.
    const bel = encodeMarker(TOKEN, SESSION, 1);
    const st = withStTerminator(encodeMarker(TOKEN, SESSION, 2));

    expect(markersIn(`a${bel}b${st}`, TOKEN, SESSION).map((m) => m.revision)).toEqual([1, 2]);
  });

  it('reports offsets in stream order, after the bytes each marker commits', () => {
    const first = encodeMarker(TOKEN, SESSION, 1);
    const output = `FRAME-ONE${first}FRAME-TWO${encodeMarker(TOKEN, SESSION, 2)}`;

    const markers = markersIn(output, TOKEN, SESSION);
    expect(markers.map((m) => m.revision)).toEqual([1, 2]);
    expect(markers[0]?.index).toBe(output.indexOf('FRAME-ONE') + 'FRAME-ONE'.length);
    expect(markers[1]?.index).toBeGreaterThan(output.indexOf('FRAME-TWO'));
  });

  it('drops a marker that does not authenticate', () => {
    const marker = encodeMarker(TOKEN, SESSION, 3);

    expect(markersIn(marker, generateToken(), SESSION)).toEqual([]);
    expect(markersIn(marker, TOKEN, 'another-session')).toEqual([]);
  });

  it('ignores sequences that only look like markers', () => {
    const lookalikes = [
      // An OSC 8 hyperlink, the neighbour most likely to appear in real output.
      '\u001b]8;;https://example.com\u0007label\u001b]8;;\u0007',
      // Our number, someone else's payload.
      `\u001b]${String(MARKER_OSC_CODE)};not-a-marker\u0007`,
      // Our payload shape, someone else's number.
      '\u001b]8488;twm;1;abcdef\u0007',
      // The old DCS encoding, which must no longer be honoured.
      '\u001bPtwm;1;abcdef\u001b\\',
    ];

    for (const output of lookalikes) {
      expect(markersIn(output, TOKEN, SESSION), output).toEqual([]);
    }
  });

  it('cannot be made to swallow the stream by an unterminated sequence', () => {
    const unterminated = `\u001b]${String(MARKER_OSC_CODE)};twm;1;`;
    const real = encodeMarker(TOKEN, SESSION, 9);

    // The runaway sequence matches nothing, and the marker after it still does.
    expect(markersIn(`${unterminated}${real}`, TOKEN, SESSION).map((m) => m.revision)).toEqual([9]);
  });
});

describe('stripMarkers', () => {
  it('removes markers under either terminator and leaves everything else', () => {
    const output = [
      'before',
      encodeMarker(TOKEN, SESSION, 1),
      'middle',
      withStTerminator(encodeMarker(TOKEN, SESSION, 2)),
      'after',
    ].join('');

    expect(stripMarkers(output)).toBe('beforemiddleafter');
  });

  it('leaves a stream without markers byte-identical', () => {
    // This is what the dormant-rule comparison rests on.
    const plain = '\u001b[?2026h\u001b[1;1Hframe\u001b[?2026l';
    expect(stripMarkers(plain)).toBe(plain);
  });
});
