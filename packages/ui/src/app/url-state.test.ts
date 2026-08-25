import { describe, expect, it } from 'vitest';
import { parseAppUrl, sameAppUrlState, shareableAppUrl } from './url-state.js';

describe('application URL state', () => {
  it('round-trips the exact runner identity and replay position', () => {
    const state = {
      view: 'runner' as const,
      runId: 'run:one',
      executionId: 'execution:two',
      traceRef: '/tmp/a recording.twtrace',
      timeMs: 1_235,
    };
    const url = shareableAppUrl('http://127.0.0.1:4000/?token=secret&unrelated=value', state);
    expect(url.searchParams.get('token')).toBeNull();
    expect(url.searchParams.get('unrelated')).toBeNull();
    expect(parseAppUrl(url)).toEqual(state);
    expect(sameAppUrlState(parseAppUrl(url), state)).toBe(true);
  });

  it('retains a history run identity and rejects malformed route values', () => {
    expect(parseAppUrl('http://localhost/?view=runs&runId=run%3Aknown')).toEqual({ view: 'runs', runId: 'run:known' });
    expect(parseAppUrl('http://localhost/?view=unknown&runId=ignored')).toEqual({ view: 'runner' });
    expect(parseAppUrl('http://localhost/?view=runner&timeMs=-1')).toEqual({ view: 'runner' });
    expect(parseAppUrl('http://localhost/?view=runner&timeMs=NaN')).toEqual({ view: 'runner' });
  });

  it('bounds attacker-controlled identities and canonicalizes replay time', () => {
    const oversized = 'x'.repeat(4_097);
    expect(parseAppUrl(`http://localhost/?view=runner&executionId=${oversized}&timeMs=1.6`)).toEqual({ view: 'runner', timeMs: 2 });
    expect(shareableAppUrl('http://localhost/', { view: 'runner', timeMs: -2 }).searchParams.get('timeMs')).toBe('0');
  });

  it('rejects ambiguous duplicate fields', () => {
    expect(parseAppUrl('http://localhost/?view=runner&executionId=one&executionId=two&timeMs=1&timeMs=2')).toEqual({ view: 'runner' });
  });
});
