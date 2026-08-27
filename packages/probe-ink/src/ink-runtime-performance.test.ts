import { performance } from 'node:perf_hooks';
import { PassThrough } from 'node:stream';
import { getHeapStatistics } from 'node:v8';
import { DEFAULT_LIMITS } from '@termwright/protocol';
import { Box, render, Text } from 'ink';
import { createElement, Fragment } from 'react';
import { describe, expect, it } from 'vitest';
import { observeInkTree } from './observe.js';
import {
  activateInkRendererObservation,
  type InkCommitEvent,
  type InkReconcilerInstrumentation,
} from './react-commit-bridge.js';

describe('Ink runtime observer empirical cost', () => {
  it('reports traversal, serialization, CPU, allocation and memory without a timing gate', async () => {
    const holder = globalThis as typeof globalThis & {
      __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown;
    };
    const previous = Object.getOwnPropertyDescriptor(holder, '__REACT_DEVTOOLS_GLOBAL_HOOK__');
    delete holder.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const reconcilerUrl = import.meta.resolve('ink').replace(/index\.js$/u, 'reconciler.js');
    const reconciler = (
      (await import(reconcilerUrl)) as {
        readonly default: InkReconcilerInstrumentation;
      }
    ).default;
    const bridge = activateInkRendererObservation(reconciler);
    const commits: Extract<InkCommitEvent, { type: 'commit' }>[] = [];
    const release = bridge.subscribe((event) => {
      if (event.type === 'commit') commits.push(event);
    });
    const stdout = new PassThrough() as unknown as NodeJS.WriteStream;
    Object.defineProperties(stdout, {
      columns: { value: 120 },
      rows: { value: 40 },
      isTTY: { value: true },
    });
    const hostCount = 256;
    const instance = render(
      createElement(
        Fragment,
        null,
        ...Array.from({ length: hostCount }, (_, index) =>
          createElement(Box, { key: index }, createElement(Text, null, `node-${index}`)),
        ),
      ),
      { stdout, patchConsole: false, interactive: true },
    );

    try {
      await instance.waitUntilRenderFlush();
      const root = commits.at(-1)?.root;
      if (root === undefined)
        throw new Error('performance measurement did not observe an Ink root');
      const iterations = 100;
      const cpuBefore = process.cpuUsage();
      const memoryBefore = process.memoryUsage();
      const heapBefore = getHeapStatistics();
      const eventLoopBefore = performance.eventLoopUtilization();
      const wallBefore = process.hrtime.bigint();
      let serializedBytes = 0;
      let visitedNodes = 0;
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        const observation = observeInkTree(root, {
          frame: iteration,
          limits: DEFAULT_LIMITS,
        });
        visitedNodes += observation.frame.objects.length;
        serializedBytes += Buffer.byteLength(JSON.stringify(observation.frame));
      }
      const wallNanoseconds = Number(process.hrtime.bigint() - wallBefore);
      const eventLoop = performance.eventLoopUtilization(eventLoopBefore);
      const cpu = process.cpuUsage(cpuBefore);
      const memoryAfter = process.memoryUsage();
      const heapAfter = getHeapStatistics();
      const measurement = {
        iterations,
        hostCount,
        visitedNodes,
        serializedBytes,
        wallNanoseconds,
        cpuUserMicroseconds: cpu.user,
        cpuSystemMicroseconds: cpu.system,
        eventLoopUtilization: eventLoop.utilization,
        heapUsedDeltaBytes: memoryAfter.heapUsed - memoryBefore.heapUsed,
        rssDeltaBytes: memoryAfter.rss - memoryBefore.rss,
        mallocedMemoryDeltaBytes: heapAfter.malloced_memory - heapBefore.malloced_memory,
        peakMallocedMemoryBytes: heapAfter.peak_malloced_memory,
      };

      expect(visitedNodes).toBe(iterations * (hostCount * 2 + 1));
      expect(serializedBytes).toBeGreaterThan(0);
      for (const value of Object.values(measurement)) {
        expect(Number.isFinite(value)).toBe(true);
      }
      // This is intentionally output, not a pass/fail threshold. The pinned
      // tree shape and iteration count make repeated measurements comparable;
      // scheduler and allocator variance cannot turn correctness red.
      process.stderr.write(`${JSON.stringify({ inkRuntimeObserverMeasurement: measurement })}\n`);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
      release();
      if (previous === undefined) delete holder.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      else Object.defineProperty(holder, '__REACT_DEVTOOLS_GLOBAL_HOOK__', previous);
    }
  });
});
