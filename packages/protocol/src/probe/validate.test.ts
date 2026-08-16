import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, type ProtocolLimits } from '../limits.js';
import { PROBE_CAPABILITIES, PROVENANCE_SOURCES, type ProbeFrame } from './ir.js';
import { validateProbeFrame, validateProbeInfo } from './validate.js';

function object(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    identity: { kind: 'stable', value: id },
    frameworkType: 'Button',
    ...over,
  };
}

function frame(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { frame: 1, objects: [object('a')], ...over };
}

function codeOf(value: unknown, limits: ProtocolLimits = DEFAULT_LIMITS): string {
  const result = validateProbeFrame(value, limits);
  return result.ok ? 'ok' : result.code;
}

describe('validateProbeInfo', () => {
  const info = {
    framework: 'textual',
    frameworkVersion: '8.2.8',
    probeVersion: '0.1.0',
    identityKind: 'stable' as const,
    capabilities: ['stable-identity', 'visible-rect'],
  };

  it('accepts a well-formed self-description', () => {
    expect(validateProbeInfo(info).ok).toBe(true);
  });

  it('accepts a frame-local probe that claims no stable identity', () => {
    const result = validateProbeInfo({
      framework: 'ratatui',
      probeVersion: '0.1.0',
      identityKind: 'frame-local',
      capabilities: ['operations'],
    });
    expect(result.ok).toBe(true);
  });

  it('refuses a probe that is frame-local and claims stable identity', () => {
    // The pair would tell a consumer it may correlate objects across frames in
    // a framework where nothing survives the frame.
    const result = validateProbeInfo({
      ...info,
      identityKind: 'frame-local',
      capabilities: ['stable-identity'],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain('immediate-mode');
  });

  it('rejects an unknown capability rather than ignoring it', () => {
    expect(validateProbeInfo({ ...info, capabilities: ['telepathy'] }).ok).toBe(false);
  });

  it('rejects a missing framework or probe version', () => {
    const { framework: _f, ...noFramework } = info;
    expect(validateProbeInfo(noFramework).ok).toBe(false);
    expect(validateProbeInfo({ ...info, probeVersion: '' }).ok).toBe(false);
  });

  it('keeps the capability set closed', () => {
    // Spelled out rather than counted: a diff here says which capability
    // arrived, which is what the reader needs when this fails.
    expect([...PROBE_CAPABILITIES]).toEqual([
      'stable-identity',
      'visible-rect',
      'operations',
      'annotations',
      'frame-begin',
      'paint-order',
    ]);
  });
});

describe('validateProbeFrame — shape', () => {
  it('accepts a minimal frame', () => {
    expect(codeOf(frame())).toBe('ok');
  });

  it('accepts an immediate-mode frame: no objects, only operations', () => {
    // A flat op list is a legal degenerate tree, not an error — it is what
    // Ratatui frames look like.
    expect(
      codeOf({
        frame: 7,
        objects: [],
        operations: [
          { kind: 'render', ordinal: 0, frameworkType: 'List', intendedRect: { row: 0, column: 0, width: 10, height: 4 } },
          { kind: 'render', ordinal: 1, frameworkType: 'Block' },
        ],
      }),
    ).toBe('ok');
  });

  it('returns a deep-frozen frame', () => {
    const result = validateProbeFrame(frame(), DEFAULT_LIMITS);
    if (!result.ok) throw new Error(result.detail);
    const parsed: ProbeFrame = result.frame;
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.objects)).toBe(true);
    expect(Object.isFrozen(parsed.objects[0])).toBe(true);
  });

  it('requires a frameworkType on every object', () => {
    const { frameworkType: _t, ...withoutType } = object('a');
    expect(codeOf(frame({ objects: [withoutType] }))).toBe('schema');
    expect(codeOf(frame({ objects: [object('a', { frameworkType: '' })] }))).toBe('schema');
  });

  it('requires a positive frame counter', () => {
    expect(codeOf(frame({ frame: 0 }))).toBe('revision');
    expect(codeOf(frame({ frame: -1 }))).toBe('revision');
    expect(codeOf(frame({ frame: 1.5 }))).toBe('revision');
  });

  it('rejects unknown properties rather than ignoring them', () => {
    expect(codeOf(frame({ speculative: true }))).toBe('schema');
    expect(codeOf(frame({ objects: [object('a', { role: 'button' })] }))).toBe('schema');
  });

  it('rejects a bad identity kind', () => {
    expect(codeOf(frame({ objects: [object('a', { identity: { kind: 'guessed', value: 'a' } })] }))).toBe(
      'schema',
    );
  });

  it('rejects an unsafe rectangle', () => {
    expect(
      codeOf(
        frame({
          objects: [object('a', { geometry: { intendedRect: { row: 0.5, column: 0, width: 1, height: 1 } } })],
        }),
      ),
    ).toBe('bad-rect');
  });

  it('bounds objects and operations by maxNodes', () => {
    const objects = Array.from({ length: 20 }, (_, i) => object(`n${i}`));
    expect(codeOf(frame({ objects }), { ...DEFAULT_LIMITS, maxNodes: 5 })).toBe('count');
  });

  it('bounds the serialised size', () => {
    expect(
      codeOf(frame({ objects: [object('a', { text: 'x'.repeat(4096) })] }), {
        ...DEFAULT_LIMITS,
        maxSnapshotBytes: 512,
      }),
    ).toBe('bytes');
  });
});

describe('validateProbeFrame — internal consistency', () => {
  it('rejects duplicate identities within a frame', () => {
    expect(codeOf(frame({ objects: [object('a'), object('a')] }))).toBe('duplicate-id');
  });

  it('rejects a parent that is not in the same frame', () => {
    expect(codeOf(frame({ objects: [object('a', { parent: 'ghost' })] }))).toBe('missing-parent');
  });

  it('accepts a parent that is in the frame', () => {
    expect(codeOf(frame({ objects: [object('root'), object('a', { parent: 'root' })] }))).toBe('ok');
  });

  it('rejects a self-parented object', () => {
    expect(codeOf(frame({ objects: [object('a', { parent: 'a' })] }))).toBe('cycle');
  });

  it('rejects a field that is both reported and declared unobservable', () => {
    // The whole point of the three-valued model is that this cannot happen: a
    // fact cannot be observed and unobservable at once.
    expect(
      codeOf(frame({ objects: [object('a', { text: 'hi', unobservable: ['text'] })] })),
    ).toBe('schema');
    expect(
      codeOf(
        frame({
          objects: [object('a', { state: { focused: true }, unobservable: ['focused'] })],
        }),
      ),
    ).toBe('schema');
    expect(
      codeOf(
        frame({
          objects: [
            object('a', {
              geometry: { intendedRect: { row: 0, column: 0, width: 1, height: 1 } },
              unobservable: ['intendedRect'],
            }),
          ],
        }),
      ),
    ).toBe('schema');
  });

  it('accepts a field declared unobservable and not reported', () => {
    expect(
      codeOf(frame({ objects: [object('a', { unobservable: ['focused', 'disabled', 'value'] })] })),
    ).toBe('ok');
  });

  it('rejects a repeated unobservable field', () => {
    expect(codeOf(frame({ objects: [object('a', { unobservable: ['focused', 'focused'] })] }))).toBe(
      'duplicate-id',
    );
  });

  it('rejects an unknown unobservable field name', () => {
    expect(codeOf(frame({ objects: [object('a', { unobservable: ['vibes'] })] }))).toBe('schema');
  });
});

describe('validateProbeFrame — the two selections stay apart', () => {
  it('accepts an item index and a text range on the same object', () => {
    expect(
      codeOf(
        frame({
          objects: [
            object('a', { state: { selectedIndex: 3, textSelection: { start: 0, end: 5 } } }),
          ],
        }),
      ),
    ).toBe('ok');
  });

  it('will not take an index where a text range belongs', () => {
    expect(codeOf(frame({ objects: [object('a', { state: { textSelection: 3 } })] }))).toBe('schema');
  });
});

describe('validateProbeFrame — hostile input', () => {
  it('rejects a getter-backed object without invoking it', () => {
    let invoked = false;
    const hostile = {
      frame: 1,
      objects: [
        {
          identity: { kind: 'stable', value: 'a' },
          get frameworkType(): string {
            invoked = true;
            return 'Button';
          },
        },
      ],
    };
    expect(codeOf(hostile)).toBe('schema');
    expect(invoked).toBe(false);
  });

  it('rejects a cyclic frame instead of hanging', () => {
    const hostile: Record<string, unknown> = frame();
    hostile['self'] = hostile;
    expect(codeOf(hostile)).toBe('schema');
  });

  it('never throws, whatever it is handed', () => {
    for (const value of [undefined, null, 42, 'frame', [], Symbol('s'), () => 1, new Map()]) {
      expect(() => validateProbeFrame(value, DEFAULT_LIMITS)).not.toThrow();
      expect(codeOf(value)).not.toBe('ok');
    }
  });
});

describe('provenance vocabulary', () => {
  it('is closed and ranked from strongest to weakest', () => {
    expect([...PROVENANCE_SOURCES]).toEqual([
      'annotation',
      'recognizer',
      'framework',
      'correlation',
      'heuristic',
    ]);
  });
});

describe('"I do not know" is not "not any more"', () => {
  // The driver raised this as the risk in dropping a separate retraction
  // mechanism. It is covered, but only because the two are separate encodings:
  // a node resent without a field says the fact is gone, while an object
  // listing the field as unobservable says the framework cannot see it. The
  // contradiction — reporting both at once — is refused.
  it('distinguishes an unreported field from an unobservable one', () => {
    const silent = frame({ objects: [object('a')] });
    const blind = frame({ objects: [object('a', { unobservable: ['focused'] })] });
    const known = frame({ objects: [object('a', { state: { focused: false } })] });

    for (const candidate of [silent, blind, known]) {
      expect(codeOf(candidate)).toBe('ok');
    }

    const parsedBlind = validateProbeFrame(blind, DEFAULT_LIMITS);
    if (!parsedBlind.ok) throw new Error(parsedBlind.detail);
    expect(parsedBlind.frame.objects[0]!.unobservable).toEqual(['focused']);
    expect(parsedBlind.frame.objects[0]!.state?.focused).toBeUndefined();

    const parsedKnown = validateProbeFrame(known, DEFAULT_LIMITS);
    if (!parsedKnown.ok) throw new Error(parsedKnown.detail);
    // Known-false is a fact, and it is not the same as either of the others.
    expect(parsedKnown.frame.objects[0]!.state?.focused).toBe(false);
    expect(parsedKnown.frame.objects[0]!.unobservable).toBeUndefined();
  });

  it('accepts paintOrder and refuses it alongside an unobservable claim', () => {
    expect(codeOf(frame({ objects: [object('a', { paintOrder: 3 })] }))).toBe('ok');
    expect(
      codeOf(frame({ objects: [object('a', { paintOrder: 3, unobservable: ['paintOrder'] })] })),
    ).toBe('schema');
  });
});
