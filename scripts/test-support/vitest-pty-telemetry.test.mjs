import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { hasClosedChannelDiagnostic, isVitestPtyCellFailure } from './vitest-pty-diagnostics.mjs';
import { validateVitestPtyTelemetry } from './vitest-pty-telemetry.mjs';

function completeRecords(files = 2, casesPerFile = 2) {
  return Array.from({ length: files }, (_, file) => {
    const source = `pressure-${file}.test.mjs`;
    return Array.from({ length: casesPerFile }, (_, index) => ({
      source,
      index,
      phase: 'start',
      activePtys: index + 1,
      pid: file + 1,
      threadId: 0,
      timeMs: index,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      memory: { rss: 1 },
    })).concat(
      Array.from({ length: casesPerFile }, (_, index) => ({
        source,
        index,
        phase: 'finish',
        activePtys: casesPerFile - index - 1,
        pid: file + 1,
        threadId: 0,
        timeMs: casesPerFile + index,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        memory: { rss: 1 },
        readyObserved: true,
        releaseSent: true,
        doneObserved: true,
        exited: true,
      })),
    );
  }).flat();
}

const expected = {
  files: 2,
  casesPerFile: 2,
  terminals: 2,
  workers: 2,
  fileParallelism: true,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  readErrors: [],
};

describe('Vitest PTY telemetry certification', () => {
  it('accepts exactly one ordered lifecycle for every PTY case', () => {
    expect(validateVitestPtyTelemetry(completeRecords(), expected)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it.each([
    ['missing finish', (records) => records.slice(0, -1)],
    ['duplicate finish', (records) => [...records, records.at(-1)]],
    ['finish before start', (records) => [records[2], records[0], records[1], ...records.slice(3)]],
    ['invalid identity', (records) => [{ ...records[0], source: '' }, ...records.slice(1)]],
  ])('fails closed for %s', (_name, mutate) => {
    const verdict = validateVitestPtyTelemetry(mutate(completeRecords()), expected);
    expect(verdict.valid).toBe(false);
    expect(verdict.errors.length).toBeGreaterThan(0);
  });

  it('rejects incomplete runtime evidence and a missing telemetry shard', () => {
    const records = completeRecords();
    delete records[0].memory;
    const verdict = validateVitestPtyTelemetry(records, {
      ...expected,
      readErrors: ['pressure-7.test.mjs: missing'],
    });
    expect(verdict.valid).toBe(false);
    expect(verdict.errors).toContain('pressure-7.test.mjs: missing');
    expect(verdict.errors).toContain('pressure-0.test.mjs:0:start has invalid runtime telemetry');
  });

  it('rejects a parallel cell whose files never overlap on distinct workers', () => {
    const records = completeRecords().map((record) => ({
      ...record,
      pid: 1,
      timeMs: record.timeMs + (record.source === 'pressure-1.test.mjs' ? 10 : 0),
    }));
    const verdict = validateVitestPtyTelemetry(records, expected);
    expect(verdict.valid).toBe(false);
    expect(verdict.errors).toContain('observed 1 overlapping test files, expected 2');
  });

  it('rejects a PTY that exits without the complete causal handshake', () => {
    const records = completeRecords();
    records.at(-1).doneObserved = false;
    const verdict = validateVitestPtyTelemetry(records, expected);
    expect(verdict.valid).toBe(false);
    expect(verdict.errors.some((error) => error.includes('READY -> release -> DONE -> exit'))).toBe(
      true,
    );
  });

  it('rejects a cell that exceeds the exact configured worker overlap', () => {
    const records = completeRecords(3).map((record) => ({
      ...record,
      timeMs: record.phase === 'start' ? record.index : 10 + record.index,
    }));
    const verdict = validateVitestPtyTelemetry(records, { ...expected, files: 3 });
    expect(verdict.valid).toBe(false);
    expect(verdict.errors).toContain('observed 3 overlapping test files, expected 2');
  });

  it('rejects a cell that never reaches the requested PTY concurrency', () => {
    const records = completeRecords().map((record) => ({
      ...record,
      activePtys: record.phase === 'start' ? 1 : 0,
    }));
    const verdict = validateVitestPtyTelemetry(records, expected);
    expect(verdict.valid).toBe(false);
    expect(verdict.errors.some((error) => error.includes('inconsistent active PTY count'))).toBe(
      true,
    );
  });

  it('fails certification for every detected closed-channel diagnostic and requires the complete matrix', async () => {
    const harness = await readFile(
      new URL('../run-vitest-pty-matrix.mjs', import.meta.url),
      'utf8',
    );
    const pressure = await readFile(
      new URL('../../quality/experiments/vitest-pty-pressure.test.mjs', import.meta.url),
      'utf8',
    );
    const workflow = await readFile(
      new URL('../../.github/workflows/vitest-reliability.yml', import.meta.url),
      'utf8',
    );
    expect(harness).toContain('results.filter(isVitestPtyCellFailure)');
    expect(harness).toContain('certified.length !== expected.size');
    expect(harness).toContain('const versions = [embeddedVitest]');
    expect(harness).toContain('TERMWRIGHT_MATRIX_CELL_PTYS: String(terminals)');
    expect(harness).not.toContain("'npm', [...");
    expect(workflow).toContain("TERMWRIGHT_MATRIX_CERTIFY: '1'");
    expect(workflow).toContain('uses: ./.github/actions/setup-js-workspace');
    expect(workflow).toContain('pnpm --filter @termwright/driver... build');
    expect(harness).toContain("packages', 'driver', 'dist', 'experimental.js'");
    expect(pressure).toContain('context.onTestFinished');
    expect(pressure).toContain("import { createNativePtyBackend } from '../driver-backend.mjs'");
    expect(pressure).not.toContain("from '@lydell/node-pty'");
    expect(pressure).not.toContain('setInterval(advertise');
    expect(pressure.indexOf('output.includes(readyOutput)')).toBeLessThan(
      pressure.indexOf("pty.write(Buffer.from('release'))"),
    );

    for (const diagnostic of [
      'channel closed',
      'channel is closed',
      'Error [ERR_IPC_CHANNEL_CLOSED]: Channel closed',
    ]) {
      expect(hasClosedChannelDiagnostic(diagnostic)).toBe(true);
      expect(isVitestPtyCellFailure({ code: 0, telemetryValid: true, channelClosed: true })).toBe(
        true,
      );
    }
    expect(hasClosedChannelDiagnostic('subchannel closed normally')).toBe(false);
    expect(hasClosedChannelDiagnostic('all worker channels closed normally')).toBe(false);
    expect(isVitestPtyCellFailure({ code: 0, telemetryValid: true, channelClosed: false })).toBe(
      false,
    );
  });
});
