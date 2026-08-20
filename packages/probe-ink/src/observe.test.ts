import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '@termwright/protocol';
import { observeInkTree, type InkDomElement, type InkDomNode } from './observe.js';

function element(
  nodeName: InkDomElement['nodeName'],
  children: InkDomNode[] = [],
  extra: Partial<InkDomElement> = {},
): InkDomElement {
  const node = { nodeName, childNodes: children, style: {}, ...extra } as InkDomElement;
  for (const child of children) {
    Object.defineProperty(child, 'parentNode', { configurable: true, value: node });
  }
  return node;
}

function text(value: string): InkDomNode {
  return { nodeName: '#text', nodeValue: value };
}

describe('observeInkTree', () => {
  it('keeps every host, including unannotated generic boxes', () => {
    const label = element('ink-text', [text('Approve')]);
    const generic = element('ink-box', [label]);
    const root = element('ink-root', [generic]);

    const observation = observeInkTree(root, { frame: 1, limits: DEFAULT_LIMITS });

    expect(observation.frame.objects.map((object) => object.frameworkType)).toEqual([
      'ink-root',
      'ink-box',
      'ink-text',
    ]);
    expect(observation.frame.objects[2]?.text).toBe('Approve');
    expect(observation.frame.objects[2]?.parent).toBe(observation.frame.objects[1]?.identity.value);
  });

  it('keeps identity stable across live updates', () => {
    const label = element('ink-text', [text('0')]);
    const root = element('ink-root', [label]);
    const first = observeInkTree(root, { frame: 1, limits: DEFAULT_LIMITS });
    (label.childNodes[0] as { nodeValue: string }).nodeValue = '1';
    const second = observeInkTree(root, { frame: 2, limits: DEFAULT_LIMITS });

    expect(second.frame.objects[1]?.identity).toEqual(first.frame.objects[1]?.identity);
    expect(second.frame.objects[1]?.text).toBe('1');
  });

  it('omits only the probe host and propagates effective hidden state to descendants', () => {
    const ownProbe = element('ink-box', [], { style: { display: 'none' } });
    const hiddenText = element('ink-text', [text('Invisible')]);
    const appHidden = element('ink-box', [hiddenText], { style: { display: 'none' } });
    const root = element('ink-root', [ownProbe, appHidden]);

    const observation = observeInkTree(root, {
      frame: 1,
      limits: DEFAULT_LIMITS,
      excluded: ownProbe,
    });

    expect(observation.frame.objects).toHaveLength(3);
    expect(observation.frame.objects[1]?.state?.displayed).toBe(false);
    expect(observation.frame.objects[2]?.state?.displayed).toBe(false);
  });

  it('reports retained aria facts without inventing focus or source components', () => {
    const button = element('ink-box', [element('ink-text', [text('Run')])], {
      internal_accessibility: {
        role: 'button',
        state: { disabled: true, busy: false, selected: true, multiline: false },
      },
    });
    const root = element('ink-root', [button]);
    const observation = observeInkTree(root, { frame: 1, limits: DEFAULT_LIMITS });

    expect(observation.frame.objects[1]).toMatchObject({
      frameworkType: 'ink-box',
      accessibility: { role: 'button' },
      state: { disabled: true, busy: false, selected: true, multiline: false },
      unobservable: expect.arrayContaining(['focused']),
    });
    expect(observation.frame.objects[1]?.text).toBeUndefined();
    expect(observation.frame.objects[2]?.text).toBe('Run');
  });

  it('drops a forged invalid annotation without dropping the host tree', () => {
    const button = element('ink-box', [element('ink-text', [text('Run')])], {
      internal_accessibility: { role: 'button', state: { disabled: false } },
    });
    const root = element('ink-root', [button]);
    const registryKey = Symbol.for('termwright.annotation.ink.v1');
    const scope = globalThis as Record<PropertyKey, unknown>;
    const previous = scope[registryKey];
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    let invoked = 0;
    const hostileRelations = Array.from({ length: 5 });
    for (let index = 0; index < hostileRelations.length; index += 1) {
      Object.defineProperty(hostileRelations, index, {
        get() {
          invoked += 1;
          return new WeakRef(button);
        },
      });
    }
    Object.defineProperty(scope, registryKey, {
      configurable: true,
      value: {
        entries: new WeakMap<object, object>([
          [button, {
            current: {
              name: 'Run',
              actions: ['shell'],
              extended: cyclic,
              labelledBy: hostileRelations,
            },
          }],
        ]),
        listeners: new Set<() => void>(),
      },
    });

    try {
      const limits = { ...DEFAULT_LIMITS, maxRelationTargets: 1 };
      const observation = observeInkTree(root, { frame: 1, limits });
      expect(observation.frame.objects[1]).toMatchObject({
        frameworkType: 'ink-box',
        accessibility: { role: 'button' },
        state: { disabled: false },
      });
      expect(observation.frame.objects[1]?.annotations).toBeUndefined();
      expect(invoked).toBe(0);
      expect(observation.frame.objects).toHaveLength(3);
    } finally {
      Object.defineProperty(scope, registryKey, { configurable: true, value: previous });
    }
  });

  it('keeps nested host text on that host instead of duplicating it on its parent', () => {
    const nested = element('ink-virtual-text', [text('world')]);
    const label = element('ink-text', [nested]);
    const root = element('ink-root', [label]);

    const observation = observeInkTree(root, { frame: 1, limits: DEFAULT_LIMITS });

    expect(observation.frame.objects[1]?.text).toBeUndefined();
    expect(observation.frame.objects[2]?.text).toBe('world');
  });
});
