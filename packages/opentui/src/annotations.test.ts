import { describe, expect, it } from 'vitest';
import { describeRenderable, type OpenTuiSemanticAnnotation } from './index.js';

const SYMBOL = Symbol.for('termwright.annotation.opentui.v1');

describe('@termwright/opentui annotations', () => {
  it('registers without a renderer session and disposes by ownership', () => {
    const renderable = {};
    const label = {};
    const disposeFirst = describeRenderable(renderable, {
      role: 'button',
      name: 'Deploy',
      extended: { environment: 'production' },
      actions: ['activate'],
      labelledBy: [label],
    });
    const entries = (globalThis as Record<PropertyKey, unknown>)[SYMBOL] as WeakMap<object, { name?: string }>;
    expect(entries.get(renderable)).toMatchObject({ name: 'Deploy' });

    const disposeLatest = describeRenderable(renderable, { role: 'button', name: 'Redeploy' });
    disposeFirst();
    expect(entries.get(renderable)).toMatchObject({ name: 'Redeploy' });
    disposeLatest();
    expect(entries.get(renderable)).toBeUndefined();
  });

  it('does not accept physical framework facts in its public type', () => {
    const renderable = {};
    describeRenderable(renderable, {
      role: 'textbox',
      // @ts-expect-error focus is observed from OpenTUI, never authored here
      focused: true,
    });
    describeRenderable(renderable, {
      role: 'textbox',
      // @ts-expect-error values come from the Renderable itself
      value: 'forged',
    });

    describeRenderable(renderable, {
      role: 'textbox',
      // @ts-expect-error bounds come from the renderer
      bounds: { row: 0, column: 0, width: 99, height: 99 },
    });
  });

  it('drops forged physical facts at the runtime boundary', () => {
    const renderable = {};
    describeRenderable(renderable, {
      role: 'textbox',
      name: 'Message',
      state: { focused: true },
      value: 'forged',
      bounds: { row: 0, column: 0, width: 99, height: 99 },
    } as unknown as OpenTuiSemanticAnnotation);
    const entries = (globalThis as Record<PropertyKey, unknown>)[SYMBOL] as WeakMap<object, Record<string, unknown>>;
    const stored = entries.get(renderable);
    expect(stored).toMatchObject({ role: 'textbox', name: 'Message' });
    expect(stored).not.toHaveProperty('state');
    expect(stored).not.toHaveProperty('value');
    expect(stored).not.toHaveProperty('bounds');
  });
});
