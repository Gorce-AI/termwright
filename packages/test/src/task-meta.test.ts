import { describe, expect, it } from 'vitest';
import { buildTaskMeta } from './task-meta.js';
import type { ReportCrash } from './crash.js';

const crash: ReportCrash = { exit: { code: 1, signal: null }, screenTail: [], timeMs: 1 };

describe('buildTaskMeta', () => {
  it('says nothing when there is nothing to say', () => {
    expect(buildTaskMeta({})).toBeUndefined();
    expect(buildTaskMeta({ traces: [], obsoleteSnapshots: [], crashes: [], lostLogRecords: 0 })).toBeUndefined();
  });

  it('carries the lost-record count so a green run can still report it', () => {
    // The reason this field exists: a pass count cannot distinguish a test that
    // saw everything from one that saw what arrived.
    expect(buildTaskMeta({ lostLogRecords: 12 })).toEqual({ lostLogRecords: 12 });
  });

  it('omits a zero rather than sending it', () => {
    expect(buildTaskMeta({ lostLogRecords: 0, traces: ['out/a.twtrace'] })).toEqual({
      traces: ['out/a.twtrace'],
    });
  });

  it('carries every part a test produced', () => {
    expect(
      buildTaskMeta({
        traces: ['out/a.twtrace'],
        obsoleteSnapshots: ['renamed 1'],
        crashes: [crash],
        lostLogRecords: 3,
      }),
    ).toEqual({
      traces: ['out/a.twtrace'],
      obsoleteSnapshots: ['renamed 1'],
      crashes: [crash],
      lostLogRecords: 3,
    });
  });

  it('copies the arrays it is given', () => {
    const traces = ['out/a.twtrace'];
    const meta = buildTaskMeta({ traces });
    traces.push('out/b.twtrace');
    expect(meta?.traces).toEqual(['out/a.twtrace']);
  });

  it('survives the JSON round trip it makes between processes', () => {
    const meta = buildTaskMeta({ crashes: [crash], lostLogRecords: 2 });
    expect(JSON.parse(JSON.stringify(meta))).toEqual(meta);
  });
});
