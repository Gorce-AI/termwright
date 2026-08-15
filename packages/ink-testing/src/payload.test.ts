/**
 * The fixture boundary, tested from the hostile side: everything that cannot
 * survive the crossing must be refused before a process is spawned, not dropped
 * on the way.
 */

import { describe, expect, it } from 'vitest';
import {
  encodeFixturePayload,
  MAX_PAYLOAD_BYTES,
  MAX_PROPS_DEPTH,
  type FixturePayload,
  type JsonProps,
} from './payload.js';

function payload(props: JsonProps): FixturePayload {
  return { v: 1, module: 'file:///app/component.mjs', exportName: 'default', props, maxFps: 1000 };
}

describe('encodeFixturePayload', () => {
  it('round-trips plain JSON data', () => {
    const props = {
      label: 'Approve',
      count: 3,
      enabled: true,
      missing: null,
      items: ['a', { deep: ['b'] }],
    } satisfies JsonProps;

    expect(JSON.parse(encodeFixturePayload(payload(props)))).toEqual(payload(props));
  });

  it('rejects a function, naming the prop', () => {
    expect(() => encodeFixturePayload(payload({ onPress: (() => undefined) as never })))
      .toThrowError(/\$\.onPress is a function/u);
  });

  it('rejects undefined rather than dropping the key', () => {
    expect(() => encodeFixturePayload(payload({ label: undefined as never }))).toThrowError(
      /\$\.label is undefined/u,
    );
  });

  it('rejects values JSON cannot represent', () => {
    expect(() => encodeFixturePayload(payload({ size: Number.NaN }))).toThrowError(/is NaN/u);
    expect(() => encodeFixturePayload(payload({ id: 1n as never }))).toThrowError(/is a bigint/u);
    expect(() => encodeFixturePayload(payload({ when: new Date() as never }))).toThrowError(
      /Date instance/u,
    );
  });

  it('rejects a cycle instead of overflowing the stack', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic['self'] = cyclic;

    expect(() => encodeFixturePayload(payload(cyclic as JsonProps))).toThrowError(/part of a cycle/u);
  });

  it('rejects props nested deeper than the limit', () => {
    let nested: JsonProps = { leaf: 'x' };
    for (let depth = 0; depth <= MAX_PROPS_DEPTH; depth += 1) nested = { nested };

    expect(() => encodeFixturePayload(payload(nested))).toThrowError(/nests deeper than/u);
  });

  it('rejects an oversized payload with a capacity error', () => {
    const props = { blob: 'x'.repeat(MAX_PAYLOAD_BYTES) } satisfies JsonProps;

    try {
      encodeFixturePayload(payload(props));
      expect.unreachable('oversized payload was accepted');
    } catch (error) {
      expect(error).toMatchObject({ code: 'capacity' });
    }
  });

  it('accepts a payload just under the limit', () => {
    const props = { blob: 'x'.repeat(MAX_PAYLOAD_BYTES - 200) } satisfies JsonProps;

    expect(Buffer.byteLength(encodeFixturePayload(payload(props)))).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES);
  });
});
