import { describe, expect, it } from 'vitest';
import {
  parseDarwinFootprint,
  parseDarwinOpenFileDescriptors,
  parseProcessTable,
  sameProcessGeneration,
  sameProcessSet,
} from './process-resource-observation.mjs';

describe('process resource observation', () => {
  it('retains process start identity independently of PID', () => {
    const table = parseProcessTable(
      [
        '  12  1 Tue Aug 25 10:00:00 2026 node host.js',
        '  13 12 Tue Aug 25 10:00:01 2026 node app.js',
      ].join('\n'),
    );
    expect(table.get(13)).toEqual({
      ppid: 12,
      startedAt: 'Tue Aug 25 10:00:01 2026',
      command: 'node app.js',
    });
    expect(
      sameProcessSet(
        { pids: [12, 13], table },
        { pids: [12, 13], table: new Map(table).set(13, { ...table.get(13), startedAt: 'later' }) },
      ),
    ).toBe(false);
    expect(
      sameProcessSet(
        { pids: [12, 13], table },
        { pids: [12, 13], table: new Map(table).set(13, { ...table.get(13), ppid: 1 }) },
      ),
    ).toBe(false);
    expect(sameProcessGeneration(table.get(13), { ...table.get(13), ppid: 1 })).toBe(true);
    expect(
      sameProcessGeneration(table.get(13), { ...table.get(13), command: 'node replacement.js' }),
    ).toBe(true);
    expect(
      sameProcessSet(
        { pids: [12, 13], table },
        { pids: [12, 14], table: new Map(table).set(14, { ...table.get(13), ppid: 12 }) },
      ),
    ).toBe(false);
  });

  it('uses the de-duplicated multi-process Summary Footprint', () => {
    const output = [
      'node [12]: 64-bit    Footprint: 700 B (16384 bytes per page)',
      '    phys_footprint: 900 B',
      'node [13]: 64-bit    Footprint: 800 B (16384 bytes per page)',
      '    phys_footprint: 1000 B',
      'Summary Footprint: 1200 B',
    ].join('\n');
    expect(parseDarwinFootprint(output, [12, 13])).toBe(1200);
  });

  it('fails closed when footprint omits a requested process or aggregate', () => {
    expect(() => parseDarwinFootprint('node [12]: 64-bit Footprint: 700 B', [12, 13])).toThrow(
      /one complete aggregate/u,
    );
    expect(() =>
      parseDarwinFootprint(
        'node [12]: 64-bit Footprint: 700 B\nnode [13]: 64-bit Footprint: 800 B',
        [12, 13],
      ),
    ).toThrow(/one complete aggregate/u);
  });

  it('counts only numeric file descriptors and requires every lsof process section', () => {
    const output = ['p12', 'fcwd', 'f0', 'f1', 'p13', 'ftxt', 'f2'].join('\n');
    expect(parseDarwinOpenFileDescriptors(output, [12, 13])).toBe(3);
    expect(() => parseDarwinOpenFileDescriptors(output, [12, 13, 14])).toThrow(/all 3 requested/u);
  });
});
