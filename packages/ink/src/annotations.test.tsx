import { PassThrough } from 'node:stream';
import { createRef } from 'react';
import { Box, Text, render, type DOMElement } from 'ink';
import { describe, expect, it } from 'vitest';
import { Semantic, useSemantic } from './index.js';
import type { InkSemanticAnnotation } from './types.js';

const SYMBOL = Symbol.for('termwright.annotation.ink.v1');

function outputStream(): { readonly stream: NodeJS.WriteStream; text(): string } {
  const stream = new PassThrough() as unknown as NodeJS.WriteStream;
  Object.defineProperties(stream, {
    columns: { configurable: true, value: 40 },
    rows: { configurable: true, value: 8 },
    isTTY: { configurable: true, value: false },
  });
  let output = '';
  (stream as unknown as PassThrough).on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  return { stream, text: () => output };
}

describe('@termwright/ink annotations', () => {
  it('registers before any probe session and follows reconciliation', async () => {
    const ref = createRef<DOMElement>();
    const App = ({ name }: { readonly name: string }) => {
      useSemantic(ref, { role: 'button', name, testId: 'save', extended: { area: 'editor' } });
      return (
        <Box ref={ref}>
          <Text>Save</Text>
        </Box>
      );
    };
    const stdout = outputStream();
    const instance = render(<App name="Save draft" />, {
      stdout: stdout.stream,
      patchConsole: false,
    });
    await instance.waitUntilRenderFlush();

    const channel = (globalThis as Record<PropertyKey, unknown>)[SYMBOL] as {
      entries: WeakMap<object, { current: { name?: string } }>;
    };
    const registry = channel.entries;
    expect(registry.get(ref.current as DOMElement)?.current).toMatchObject({ name: 'Save draft' });

    instance.rerender(<App name="Save final" />);
    await instance.waitUntilRenderFlush();
    expect(registry.get(ref.current as DOMElement)?.current).toMatchObject({ name: 'Save final' });
    const mountedNode = ref.current as DOMElement;
    instance.unmount();
    await instance.waitUntilExit();
    expect(registry.get(mountedNode)).toBeUndefined();
  });

  it('<Semantic> adds no host node and changes no terminal bytes', async () => {
    const plainOut = outputStream();
    const annotatedOut = outputStream();
    const child = (
      <Box>
        <Text>Deploy</Text>
      </Box>
    );
    const plain = render(child, { stdout: plainOut.stream, patchConsole: false });
    const annotated = render(
      <Semantic role="button" name="Deploy">
        <Box>
          <Text>Deploy</Text>
        </Box>
      </Semantic>,
      { stdout: annotatedOut.stream, patchConsole: false },
    );
    await Promise.all([plain.waitUntilRenderFlush(), annotated.waitUntilRenderFlush()]);
    plain.unmount();
    annotated.unmount();
    await Promise.all([plain.waitUntilExit(), annotated.waitUntilExit()]);
    expect(annotatedOut.text()).toBe(plainOut.text());
  });

  it('drops forged physical facts at the runtime boundary', async () => {
    const ref = createRef<DOMElement>();
    const forged = {
      role: 'textbox',
      name: 'Message',
      state: { focused: true },
      value: 'forged',
      bounds: { row: 0, column: 0, width: 99, height: 99 },
    } as unknown as InkSemanticAnnotation;
    const App = () => {
      useSemantic(ref, forged);
      return (
        <Box ref={ref}>
          <Text>real text</Text>
        </Box>
      );
    };
    const stdout = outputStream();
    const instance = render(<App />, { stdout: stdout.stream, patchConsole: false });
    await instance.waitUntilRenderFlush();

    const channel = (globalThis as Record<PropertyKey, unknown>)[SYMBOL] as {
      entries: WeakMap<object, { current: Record<string, unknown> }>;
    };
    const stored = channel.entries.get(ref.current as DOMElement)?.current;
    expect(stored).toMatchObject({ role: 'textbox', name: 'Message' });
    expect(stored).not.toHaveProperty('state');
    expect(stored).not.toHaveProperty('value');
    expect(stored).not.toHaveProperty('bounds');

    instance.unmount();
    await instance.waitUntilExit();
  });
});
