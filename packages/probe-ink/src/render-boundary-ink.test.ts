import { PassThrough } from 'node:stream';
import { createElement, type ComponentType } from 'react';
import { Box, render, type DOMElement } from 'ink';
import { describe, expect, it } from 'vitest';

const COMMIT_GENERATION_ATTRIBUTE = '__termwrightCommitGeneration';

describe('Ink host render boundary integration', () => {
  it('commits hidden Box metadata into host style before the real onRender callback', async () => {
    const stdout = new PassThrough() as unknown as NodeJS.WriteStream;
    Object.defineProperties(stdout, {
      columns: { value: 20 },
      rows: { value: 8 },
      isTTY: { value: true },
    });
    const ref: { current: DOMElement | null } = { current: null };
    const generations: unknown[] = [];
    const HostBox = Box as ComponentType<Record<string, unknown>>;
    const node = (generation: number) =>
      createElement(HostBox, {
        ref,
        display: 'none',
        [COMMIT_GENERATION_ATTRIBUTE]: generation,
      });
    const instance = render(node(0), {
      stdout,
      patchConsole: false,
      onRender() {
        generations.push(
          (
            ref.current as
              | (DOMElement & {
                  style?: Record<string, unknown>;
                })
              | null
          )?.style?.[COMMIT_GENERATION_ATTRIBUTE],
        );
      },
    });

    try {
      await instance.waitUntilRenderFlush();
      const beforeRerender = generations.length;
      expect(generations).toEqual([undefined]);
      instance.rerender(node(1));
      await instance.waitUntilRenderFlush();
      const committed = generations.slice(beforeRerender);
      expect(committed.length).toBeGreaterThan(0);
      expect(committed.every((generation) => generation === 1)).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
