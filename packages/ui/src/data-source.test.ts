import { describe, expect, it } from 'vitest';

const project = { name: 'demo', root: '/repo', branch: 'main', version: '0.1.0' };
import {
  INLINE_PAYLOAD_KEY,
  InlineDataSource,
  readInlinePayload,
  type InlinePayload,
} from './data-source.js';

const record = (t: number) => ({
  t,
  source: 'adapter' as const,
  level: 'info' as const,
  message: `line ${t}`,
});

const payload = (count: number): InlinePayload => ({
  v: 1,
  state: { mode: 'post-mortem', project, sessions: [], trace: null, record: null },
  frames: { frames: [], truncated: false, durationMs: 1_000, revisions: [] },
  commands: { commands: [], incomplete: false },
  traceState: {
    timeMs: 0,
    castPrefixB64: '',
    columns: 80,
    rows: 24,
    revision: null,
    snapshot: null,
    step: null,
  },
  logs: {
    records: Array.from({ length: count }, (_, index) => record(index * 10)),
    hasMoreBefore: false,
    hasMoreAfter: false,
    total: count,
    truncated: false,
    dropped: 0,
    available: true,
    sources: [],
    levels: {},
  },
});

describe('reading the payload of a self-contained report', () => {
  it('finds it on the page it was emitted into', () => {
    const scope = { [INLINE_PAYLOAD_KEY]: payload(1) };
    expect(readInlinePayload(scope)?.v).toBe(1);
  });

  it('says there is none when a server serves the page', () => {
    expect(readInlinePayload({})).toBeUndefined();
  });

  it('ignores a payload numbered by a build this viewer is not', () => {
    // The report and the viewer inside it are emitted together, so a mismatch
    // is a mixed-up file rather than something to adapt to.
    expect(readInlinePayload({ [INLINE_PAYLOAD_KEY]: { v: 2 } })).toBeUndefined();
  });
});

describe('an inline source', () => {
  it('offers nothing it cannot do', () => {
    const source = new InlineDataSource(payload(1));
    expect(source.features).toEqual({ live: false, history: false, openTrace: false });
  });

  it('refuses operations that need a server while answering retained trace state', async () => {
    const source = new InlineDataSource(payload(1));
    await expect(source.runs()).rejects.toThrow(/no run history/);
    await expect(source.openTrace()).rejects.toThrow(/cannot open another archive/);
    expect((await source.traceState()).columns).toBe(80);
  });

  it('windows the log exactly as the server route does', async () => {
    const source = new InlineDataSource(payload(500));

    const latest = await source.traceLogs({ limit: 10 });
    expect(latest.records.map((entry) => entry.t)).toEqual([
      4900, 4910, 4920, 4930, 4940, 4950, 4960, 4970, 4980, 4990,
    ]);
    expect(latest.hasMoreBefore).toBe(true);
    expect(latest.hasMoreAfter).toBe(false);

    const later = await source.traceLogs({ after: 100, limit: 3 });
    expect(later.records.map((entry) => entry.t)).toEqual([100, 110, 120]);
    expect(later.hasMoreBefore).toBe(true);

    // `before` returns the window that ends just under the bound, which is what
    // the panel asks for when a scrub moves back past what it holds.
    const older = await source.traceLogs({ before: 100, limit: 3 });
    expect(older.records.map((entry) => entry.t)).toEqual([70, 80, 90]);
  });

  it('caps a window the way the server caps it', async () => {
    const source = new InlineDataSource(payload(900));
    expect((await source.traceLogs({ limit: 10_000 })).records).toHaveLength(500);
  });
});
