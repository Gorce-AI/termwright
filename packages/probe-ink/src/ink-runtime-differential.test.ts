import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { createElement, Fragment, type ComponentType, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { captureInkLayout, type InkFrameCapture, type InkFrameContext } from './frame-capture.js';
import {
  INK_FRAME_CONTEXT,
  INK_RENDER_CAPTURE,
  instrumentInkCore,
  instrumentInkRenderer,
  type InkRenderedOutput,
} from './instrumentation.js';
import type { InkDomElement, InkDomNode } from './observe.js';
import {
  activateInkRendererObservation,
  type InkCommitEvent,
  type InkReconcilerInstrumentation,
} from './react-commit-bridge.js';

interface DifferentialInkModule {
  readonly Box: ComponentType<Record<string, unknown>>;
  readonly Static: ComponentType<{
    readonly items: readonly string[];
    readonly children: (item: string) => ReactNode;
  }>;
  readonly Text: ComponentType<Record<string, unknown>>;
  useFocus(options: { readonly id: string; readonly autoFocus?: boolean }): {
    readonly isFocused: boolean;
    readonly focus: (id: string) => void;
  };
  useInput(handler: (input: string, key: Record<string, boolean>) => void): void;
  render(node: ReactNode, options: Record<string, unknown>): DifferentialInkInstance;
}

interface DifferentialInkInstance {
  rerender(node: ReactNode): void;
  unmount(): void;
  waitUntilExit(): Promise<unknown>;
  waitUntilRenderFlush(): Promise<void>;
}

interface ExactCapture {
  readonly root: InkDomElement;
  readonly rendered: InkRenderedOutput;
  readonly screenReader: boolean;
  readonly facts: readonly HostFact[];
  readonly frame?: InkFrameCapture;
}

interface HostFact {
  readonly path: string;
  readonly nodeName: string;
  readonly text?: string;
  readonly role?: string;
  readonly state?: Readonly<Record<string, boolean>>;
  readonly geometry?: readonly [number, number, number, number];
  readonly display?: unknown;
  readonly static: boolean;
}

const require = createRequire(import.meta.url);
const upstreamBuild = dirname(require.resolve('ink'));

describe('Ink exact-source versus React runtime observer', () => {
  it('proves committed-root parity and records the remaining non-root contracts', async () => {
    const materialized = await materializeInstrumentedInk();
    const globals = globalThis as Record<PropertyKey, unknown> & {
      __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown;
    };
    const priorHook = Object.getOwnPropertyDescriptor(globals, '__REACT_DEVTOOLS_GLOBAL_HOOK__');
    const priorCapture = globals[INK_RENDER_CAPTURE];
    const priorContext = globals[INK_FRAME_CONTEXT];
    delete globals.__REACT_DEVTOOLS_GLOBAL_HOOK__;

    const exact: ExactCapture[] = [];
    const contexts: Array<{
      readonly root: InkDomElement;
      readonly value: InkFrameContext;
    }> = [];
    const sequence: string[] = [];
    globals[INK_RENDER_CAPTURE] = (
      root: InkDomElement,
      rendered: InkRenderedOutput,
      screenReader: boolean,
    ): void => {
      const facts = hostFacts(root);
      exact.push({
        root,
        rendered,
        screenReader,
        facts,
        ...(screenReader ? {} : { frame: captureInkLayout(root, rendered) }),
      });
      sequence.push(`exact:${digestFacts(facts)}`);
    };
    globals[INK_FRAME_CONTEXT] = (root: InkDomElement, value: InkFrameContext): void => {
      contexts.push({ root, value });
      sequence.push(`context:${digestFacts(hostFacts(root))}`);
    };

    const ink = (await import(
      `${materialized.indexUrl}?suite=${materialized.id}`
    )) as DifferentialInkModule;
    // Import the exact reconciler instance already referenced by index.js.
    // Adding a query here would create a second renderer that never commits.
    const reconciler = (
      (await import(materialized.reconcilerUrl)) as {
        readonly default: InkReconcilerInstrumentation;
      }
    ).default;
    const bridge = activateInkRendererObservation(reconciler);
    const commits: Extract<InkCommitEvent, { type: 'commit' }>[] = [];
    const commitFacts = new Map<Extract<InkCommitEvent, { type: 'commit' }>, readonly HostFact[]>();
    const unmounts: Extract<InkCommitEvent, { type: 'unmount' }>[] = [];
    const release = bridge.subscribe((event) => {
      if (event.type === 'commit') {
        commits.push(event);
        const facts = hostFacts(event.root);
        commitFacts.set(event, facts);
        sequence.push(`commit:${digestFacts(facts)}`);
      } else if (event.type === 'unmount') {
        unmounts.push(event);
        sequence.push('unmount');
      }
    });

    const instances: DifferentialInkInstance[] = [];
    try {
      const stdout = tty(24, 8);
      const renders: Array<{
        readonly old: ExactCapture;
        readonly context: InkFrameContext;
      }> = [];
      const component = (label: string, checked: boolean): ReactNode =>
        createElement(
          Fragment,
          null,
          createElement(
            ink.Box,
            {
              borderStyle: 'single',
              width: 12,
              overflow: 'hidden',
              'aria-role': 'checkbox',
              'aria-label': `${label} control`,
              'aria-state': { checked, disabled: !checked },
            },
            createElement(ink.Text, { wrap: 'wrap' }, `${label} wide 界界界`),
          ),
          createElement(ink.Box, { display: 'none' }, createElement(ink.Text, null, 'hidden')),
        );
      const instance = ink.render(component('first', false), {
        stdout,
        stderr: tty(24, 8),
        patchConsole: false,
        interactive: true,
        onRender() {
          const old = exact.at(-1);
          const context = contexts.at(-1);
          if (old === undefined || context === undefined) {
            throw new Error('differential observer missed a causal predecessor of onRender');
          }
          expect(context.root).toBe(old.root);
          renders.push({ old, context: context.value });
          sequence.push(`render:${digestFacts(hostFacts(old.root))}`);
        },
      });
      instances.push(instance);
      await instance.waitUntilRenderFlush();

      expect(renders).toHaveLength(1);
      const first = pair(renders[0]!, commits, commitFacts);
      assertHostParity(first);
      expect(first.old.rendered.outputHeight).toBe(rootHeight(first.runtimeRoot));
      expect(hostFacts(first.runtimeRoot)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            nodeName: 'ink-box',
            role: 'checkbox',
            state: { checked: false, disabled: true },
          }),
          expect.objectContaining({
            nodeName: 'ink-text',
            text: 'first wide 界界界',
          }),
          expect.objectContaining({ nodeName: 'ink-box', display: 'none' }),
        ]),
      );

      instance.rerender(component('second', true));
      await instance.waitUntilRenderFlush();
      expect(renders).toHaveLength(2);
      const second = pair(renders[1]!, commits, commitFacts);
      assertHostParity(second);
      expect(hostFacts(second.runtimeRoot)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            nodeName: 'ink-box',
            role: 'checkbox',
            state: { checked: true, disabled: false },
          }),
          expect.objectContaining({
            nodeName: 'ink-text',
            text: 'second wide 界界界',
          }),
        ]),
      );
      // Stable host identity survives rerender on both paths.
      expect(second.runtimeRoot).toBe(first.runtimeRoot);

      instance.rerender(createElement(ink.Text, null, 'replacement-root'));
      await instance.waitUntilRenderFlush();
      const replacement = pair(renders.at(-1)!, commits, commitFacts);
      assertHostParity(replacement);
      expect(replacement.runtimeRoot).toBe(first.runtimeRoot);
      expect(replacement.runtimeFacts.some((fact) => fact.text === 'replacement-root')).toBe(true);
      expect(replacement.runtimeFacts.some((fact) => fact.role === 'checkbox')).toBe(false);

      const beforeRapid = renders.length;
      instance.rerender(component('superseded', false));
      instance.rerender(component('authoritative', true));
      await instance.waitUntilRenderFlush();
      expect(renders.length).toBeGreaterThan(beforeRapid);
      const authoritative = pair(renders.at(-1)!, commits, commitFacts);
      assertHostParity(authoritative);
      expect(
        hostFacts(authoritative.runtimeRoot).some((fact) => fact.text?.includes('superseded')),
      ).toBe(false);
      expect(
        hostFacts(authoritative.runtimeRoot).some((fact) => fact.text?.includes('authoritative')),
      ).toBe(true);

      // Resize is causally triggered by Ink's public stdout resize event. Both
      // exact capture and public onRender see post-layout Yoga dimensions, but
      // React does not commit because the host tree itself did not reconcile.
      const commitsBeforeResize = commits.length;
      stdout.columns = 16;
      stdout.emit('resize');
      await instance.waitUntilRenderFlush();
      const resized = pair(renders.at(-1)!, commits, commitFacts);
      expect(commits).toHaveLength(commitsBeforeResize);
      expect(resized.runtimeFacts).not.toEqual(resized.old.facts);
      expect(rootWidth(resized.runtimeRoot)).toBe(16);
      expect(resized.old.facts[0]?.geometry?.[2]).toBe(16);
      expect(resized.runtimeFacts[0]?.geometry?.[2]).toBe(24);
      expect(resized.context.rows).toBe(8);

      await assertStaticRetention(ink, bridge, exact, commits, commitFacts, contexts, instances);
      await assertClippingWrappingAndRelativeVisibility(ink, exact, commits, contexts, instances);
      await assertModeFacts(ink, exact, commits, contexts, instances);
      await assertTerminalBehavior(ink, exact, commits, contexts);
      await assertResolvedInteractiveDefault(ink, exact, contexts);
      await assertInputAndFocus(ink, commits, instances);
      await assertMultipleRoots(ink, bridge, exact, commits, instances);

      const rootsBeforeUnmount = bridge.roots();
      const unmountCount = unmounts.length;
      await disposeInstance(instance, instances);
      expect(unmounts.length).toBeGreaterThan(unmountCount);
      // Current public React callback reports Fiber unmounts, but does not
      // identify which FiberRoot should be evicted without consulting Fiber.
      // This assertion deliberately records the remaining lifecycle gap.
      expect(bridge.roots()).toEqual(rootsBeforeUnmount);

      assertMeasuredCausalOrdering(sequence);
    } finally {
      for (const instance of instances) {
        instance.unmount();
        await instance.waitUntilExit();
      }
      release();
      if (priorCapture === undefined) delete globals[INK_RENDER_CAPTURE];
      else globals[INK_RENDER_CAPTURE] = priorCapture;
      if (priorContext === undefined) delete globals[INK_FRAME_CONTEXT];
      else globals[INK_FRAME_CONTEXT] = priorContext;
      if (priorHook === undefined) delete globals.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      else Object.defineProperty(globals, '__REACT_DEVTOOLS_GLOBAL_HOOK__', priorHook);
      await rm(materialized.directory, { recursive: true, force: true });
    }
  });
});

async function assertStaticRetention(
  ink: DifferentialInkModule,
  bridge: ReturnType<typeof activateInkRendererObservation>,
  exact: ExactCapture[],
  commits: Extract<InkCommitEvent, { type: 'commit' }>[],
  commitFacts: ReadonlyMap<Extract<InkCommitEvent, { type: 'commit' }>, readonly HostFact[]>,
  contexts: Array<{
    readonly root: InkDomElement;
    readonly value: InkFrameContext;
  }>,
  instances: DifferentialInkInstance[],
): Promise<void> {
  const stdout = tty(20, 8);
  const boundaries: ExactCapture[] = [];
  const runtime: Array<{
    readonly root: InkDomElement;
    readonly facts: readonly HostFact[];
  }> = [];
  const item = (value: string): ReactNode => createElement(ink.Text, { key: value }, value);
  let exactCursor = exact.length;
  const tree = (items: readonly string[], live: string): ReactNode =>
    createElement(
      Fragment,
      null,
      createElement(ink.Static, { items, children: item }),
      createElement(ink.Text, null, live),
    );
  const instance = ink.render(tree(['history-1'], 'live-1'), {
    stdout,
    patchConsole: false,
    interactive: true,
    onRender() {
      const candidates = exact.slice(exactCursor);
      exactCursor = exact.length;
      // Static's layout effect immediately schedules a second renderer call
      // which clears the transient host subtree. The production exact hook
      // retains the earlier non-empty capture, so the differential control
      // must select it from this render pass rather than only reading at(-1).
      const old =
        candidates.find((candidate) => candidate.rendered.staticOutput.includes('history-')) ??
        candidates.at(-1);
      if (old === undefined) throw new Error('Static onRender had no exact renderer capture');
      if (contexts.at(-1)?.root !== old.root) {
        throw new Error('Static render was not paired to its committed root');
      }
      boundaries.push(old);
    },
  });
  instances.push(instance);
  await instance.waitUntilRenderFlush();
  runtime.push(committedSnapshot(boundaries.at(-1)!, commits, commitFacts));
  instance.rerender(tree(['history-1', 'history-2'], 'live-2'));
  await instance.waitUntilRenderFlush();
  runtime.push(committedSnapshot(boundaries.at(-1)!, commits, commitFacts));

  expect(boundaries.length).toBeGreaterThanOrEqual(2);
  for (const [index, boundary] of boundaries.entries()) {
    expect(boundary.rendered.staticOutput.length).toBeGreaterThan(0);
    expect(boundary.frame?.staticRows).toBeGreaterThan(0);
    if (index < runtime.length) expect(runtime[index]?.root).toBe(boundary.root);
  }
  const retained = boundaries.filter((boundary) =>
    boundary.rendered.staticOutput.includes('history-'),
  );
  expect(retained.length).toBeGreaterThan(0);
  const latestOld = retained.at(-1)!;
  expect(
    [...latestOld.frame!.staticChildren.values()]
      .flat()
      .some((node) => node.nodeName === '#text' && node.nodeValue.startsWith('history-')),
  ).toBe(true);
  const latestRuntime = runtime.at(-1)!;
  const oldStaticHeight = [...latestOld.frame!.geometry.values()]
    .filter((geometry) => geometry.region === 'static')
    .reduce((height, geometry) => Math.max(height, geometry.intended.height), 0);
  const runtimeStaticHeight = latestRuntime.facts
    .filter((fact) => fact.static)
    .reduce((height, fact) => Math.max(height, fact.geometry?.[3] ?? 0), 0);
  // Measured gap: by the DevTools callback, Ink has detached/zeroed the
  // transient Static layout which the exact renderer hook saw and rendered.
  expect(oldStaticHeight).toBeGreaterThan(0);
  expect(runtimeStaticHeight).toBe(0);
  expect(latestRuntime.facts).not.toEqual(latestOld.facts);
  expect(bridge.roots()).toContain(latestOld.root);
  await disposeInstance(instance, instances);
}

async function assertClippingWrappingAndRelativeVisibility(
  ink: DifferentialInkModule,
  exact: ExactCapture[],
  commits: Extract<InkCommitEvent, { type: 'commit' }>[],
  contexts: Array<{
    readonly root: InkDomElement;
    readonly value: InkFrameContext;
  }>,
  instances: DifferentialInkInstance[],
): Promise<void> {
  let boundary: ExactCapture | undefined;
  const instance = ink.render(
    createElement(
      ink.Box,
      {
        width: 8,
        height: 5,
        overflow: 'hidden',
        borderStyle: 'single',
        flexDirection: 'column',
      },
      createElement(
        ink.Box,
        { marginLeft: 4, width: 8, flexShrink: 0 },
        createElement(ink.Text, null, 'CLIPPED-WIDE'),
      ),
      createElement(
        ink.Box,
        { width: 5, flexShrink: 0 },
        createElement(ink.Text, { wrap: 'wrap' }, '界界界界'),
      ),
    ),
    {
      stdout: tty(20, 8),
      patchConsole: false,
      interactive: true,
      onRender() {
        boundary = exact.at(-1);
      },
    },
  );
  instances.push(instance);
  await instance.waitUntilRenderFlush();
  if (boundary === undefined || boundary.frame === undefined) {
    throw new Error('clipping differential missed the exact frame');
  }
  expect(contexts.findLast((entry) => entry.root === boundary?.root)).toBeDefined();
  const commit = commits.findLast((entry) => entry.root === boundary?.root);
  if (commit === undefined) throw new Error('clipping differential missed the React commit');

  // Recompute only relative layout from containerInfo. Empty rendered output
  // is deliberate: this proves nested clipping/wrapping is a host-DOM + Yoga
  // fact, while terminal placement remains a separate old-path contract.
  const runtime = captureInkLayout(commit.root, {
    output: '',
    outputHeight: 0,
    staticOutput: '',
  });
  const clipped = findElementByOwnText(commit.root, 'CLIPPED-WIDE');
  const wrapped = findElementByOwnText(commit.root, '界界界界');
  if (clipped === undefined || wrapped === undefined)
    throw new Error('clipping differential missed expected Ink text hosts');
  const oldClipped = boundary.frame.geometry.get(clipped);
  const runtimeClipped = runtime.geometry.get(clipped);
  const oldWrapped = boundary.frame.geometry.get(wrapped);
  const runtimeWrapped = runtime.geometry.get(wrapped);
  expect(runtimeClipped).toEqual(oldClipped);
  expect(runtimeWrapped).toEqual(oldWrapped);
  expect(oldClipped?.visible.width).toBeLessThan(oldClipped?.intended.width ?? 0);
  expect(oldWrapped?.intended.height).toBeGreaterThan(1);
  // Absolute viewport rows cannot be reconstructed from this relative capture:
  // they still require output rows, mode and ordered terminal position.
  expect(runtime.liveRows).toBe(0);
  expect(boundary.frame.liveRows).toBeGreaterThan(0);
  await disposeInstance(instance, instances);
}

async function assertInputAndFocus(
  ink: DifferentialInkModule,
  commits: Extract<InkCommitEvent, { type: 'commit' }>[],
  instances: DifferentialInkInstance[],
): Promise<void> {
  const stdin = ttyInput();
  const stdout = tty(30, 8);
  const inputs: string[] = [];
  let focusSecond: (() => void) | undefined;
  let resolveRender: (() => void) | undefined;
  let resolveInput: (() => void) | undefined;
  const nextRender = (): Promise<void> =>
    new Promise((resolve) => {
      resolveRender = resolve;
    });
  const Focusable = ({
    id,
    autoFocus = false,
  }: {
    readonly id: string;
    readonly autoFocus?: boolean;
  }): ReactNode => {
    const { isFocused, focus } = ink.useFocus({ id, autoFocus });
    if (id === 'second') focusSecond = () => focus('second');
    ink.useInput((input) => {
      if (isFocused) {
        inputs.push(`${id}:${input}`);
        resolveInput?.();
        resolveInput = undefined;
      }
    });
    return createElement(ink.Text, null, `${id}:${isFocused ? 'focused' : 'idle'}`);
  };
  const initialRender = nextRender();
  const instance = ink.render(
    createElement(
      Fragment,
      null,
      createElement(Focusable, { id: 'first', autoFocus: true }),
      createElement(Focusable, { id: 'second' }),
    ),
    {
      stdin,
      stdout,
      patchConsole: false,
      interactive: true,
      onRender() {
        resolveRender?.();
        resolveRender = undefined;
      },
    },
  );
  instances.push(instance);
  await Promise.all([initialRender, instance.waitUntilRenderFlush()]);
  const initialCommit = commits.at(-1);
  expect(
    initialCommit === undefined ? [] : hostFacts(initialCommit.root).map((fact) => fact.text),
  ).toEqual(expect.arrayContaining(['first:focused', 'second:idle']));

  const firstInput = new Promise<void>((resolve) => {
    resolveInput = resolve;
  });
  stdin.write('x');
  await firstInput;
  expect(inputs).toEqual(['first:x']);

  if (focusSecond === undefined) throw new Error('focus manager did not expose the second target');
  const focusRender = nextRender();
  focusSecond();
  await Promise.all([focusRender, instance.waitUntilRenderFlush()]);
  const focusedSecond = commits.at(-1);
  expect(
    focusedSecond === undefined ? [] : hostFacts(focusedSecond.root).map((fact) => fact.text),
  ).toEqual(expect.arrayContaining(['first:idle', 'second:focused']));
  const secondInput = new Promise<void>((resolve) => {
    resolveInput = resolve;
  });
  stdin.write('y');
  await secondInput;
  expect(inputs).toEqual(['first:x', 'second:y']);

  // Focus/input behavior is observable through component output and commits,
  // but Ink does not attach focus identity to its host DOM. This is an explicit
  // parity gap, not a fabricated host state.
  expect(hostFacts(commits.at(-1)!.root).some((fact) => 'focused' in fact)).toBe(false);
  await disposeInstance(instance, instances);
}

async function assertModeFacts(
  ink: DifferentialInkModule,
  exact: ExactCapture[],
  commits: Extract<InkCommitEvent, { type: 'commit' }>[],
  contexts: Array<{
    readonly root: InkDomElement;
    readonly value: InkFrameContext;
  }>,
  instances: DifferentialInkInstance[],
): Promise<void> {
  const normalOut = tty(30, 11);
  let normalContext: InkFrameContext | undefined;
  const normal = ink.render(createElement(ink.Text, null, 'mode'), {
    stdout: normalOut,
    patchConsole: false,
    interactive: true,
    alternateScreen: true,
    debug: true,
    onRender() {
      const old = exact.at(-1)!;
      const context = contexts.findLast((candidate) => candidate.root === old.root);
      normalContext = context?.value;
    },
  });
  instances.push(normal);
  await normal.waitUntilRenderFlush();
  expect(commits.findLast((candidate) => candidate.root === exact.at(-1)?.root)?.root).toBe(
    exact.at(-1)?.root,
  );
  expect(normalContext).toEqual({
    interactive: true,
    alternateScreen: true,
    debug: true,
    stdoutIsTTY: true,
    rows: 11,
  });

  let screenReaderCapture: ExactCapture | undefined;
  const screenReader = ink.render(
    createElement(
      ink.Box,
      {
        'aria-role': 'button',
        'aria-label': 'Accessible action',
      },
      createElement(ink.Text, null, 'visual label'),
    ),
    {
      stdout: tty(30, 11),
      patchConsole: false,
      interactive: true,
      isScreenReaderEnabled: true,
      onRender() {
        const old = exact.at(-1)!;
        screenReaderCapture = old;
      },
    },
  );
  instances.push(screenReader);
  await screenReader.waitUntilRenderFlush();
  expect(commits.findLast((candidate) => candidate.root === screenReaderCapture?.root)?.root).toBe(
    screenReaderCapture?.root,
  );
  expect(screenReaderCapture?.screenReader).toBe(true);
  expect(screenReaderCapture?.rendered.output).toContain('Accessible action');
  expect(hostFacts(screenReaderCapture!.root)).toEqual(
    expect.arrayContaining([expect.objectContaining({ nodeName: 'ink-box', role: 'button' })]),
  );
  await Promise.all([disposeInstance(normal, instances), disposeInstance(screenReader, instances)]);
}

async function assertTerminalBehavior(
  ink: DifferentialInkModule,
  exact: ExactCapture[],
  commits: Extract<InkCommitEvent, { type: 'commit' }>[],
  contexts: Array<{
    readonly root: InkDomElement;
    readonly value: InkFrameContext;
  }>,
): Promise<void> {
  const run = async (options: {
    readonly interactive: boolean;
    readonly alternateScreen?: boolean;
    readonly debug?: boolean;
  }): Promise<{ readonly bytes: string; readonly context: InkFrameContext }> => {
    const output = recordingTty(20, 6);
    let root: InkDomElement | undefined;
    const instance = ink.render(createElement(ink.Text, null, 'FIRST'), {
      stdout: output.stream,
      patchConsole: false,
      ...options,
      onRender() {
        root = exact.at(-1)?.root;
      },
    });
    await instance.waitUntilRenderFlush();
    instance.rerender(createElement(ink.Text, null, 'SECOND'));
    await instance.waitUntilRenderFlush();
    instance.unmount();
    await instance.waitUntilRenderFlush();
    if (root === undefined) throw new Error('terminal behavior differential missed the exact root');
    expect(commits.findLast((entry) => entry.root === root)?.root).toBe(root);
    const context = contexts.findLast((entry) => entry.root === root)?.value;
    if (context === undefined)
      throw new Error('terminal behavior differential missed frame context');
    return { bytes: output.bytes(), context };
  };

  const normal = await run({ interactive: true });
  expect(normal.bytes).toContain('FIRST');
  expect(normal.bytes).toContain('SECOND');
  expect(normal.bytes).toContain('\u001b[2K');
  expect(normal.bytes).not.toContain('\u001b[?1049h');
  expect(normal.context).toMatchObject({
    interactive: true,
    alternateScreen: false,
    debug: false,
  });

  const alternate = await run({ interactive: true, alternateScreen: true });
  expect(alternate.bytes).toContain('\u001b[?1049h');
  expect(alternate.bytes).toContain('\u001b[?1049l');
  expect(alternate.context.alternateScreen).toBe(true);

  const debug = await run({ interactive: true, debug: true });
  expect(debug.bytes).toContain('FIRSTSECOND');
  expect(debug.bytes).not.toContain('\u001b[2K');
  expect(debug.context.debug).toBe(true);

  const inline = await run({ interactive: false });
  expect(inline.bytes).toContain('SECOND\n');
  expect(inline.bytes).not.toContain('\u001b[2K');
  expect(inline.context.interactive).toBe(false);

  // All four modes expose equivalent committed host roots, but none of the
  // clear/alternate/debug/inline bytes above exists in containerInfo. They are
  // terminal behavior, not semantic host-tree facts.
  expect(new Set([normal, alternate, debug, inline].map((entry) => entry.context.rows))).toEqual(
    new Set([6]),
  );
}

async function assertResolvedInteractiveDefault(
  ink: DifferentialInkModule,
  exact: ExactCapture[],
  contexts: Array<{
    readonly root: InkDomElement;
    readonly value: InkFrameContext;
  }>,
): Promise<void> {
  const resolve = async (
    isTTY: boolean,
  ): Promise<{ readonly context: InkFrameContext; readonly bytes: string }> => {
    const output = recordingTty(20, 6);
    Object.defineProperty(output.stream, 'isTTY', {
      value: isTTY,
      configurable: true,
    });
    let root: InkDomElement | undefined;
    const instance = ink.render(createElement(ink.Text, null, 'default'), {
      stdout: output.stream,
      patchConsole: false,
      onRender() {
        root = exact.at(-1)?.root;
      },
    });
    await instance.waitUntilRenderFlush();
    if (root === undefined)
      throw new Error('interactive-default differential missed the exact root');
    const context = contexts.findLast((entry) => entry.root === root)?.value;
    if (context === undefined)
      throw new Error('interactive-default differential missed frame context');
    instance.unmount();
    await instance.waitUntilRenderFlush();
    return { context, bytes: output.bytes() };
  };

  const ttyDefault = await resolve(true);
  const pipeDefault = await resolve(false);
  expect(typeof ttyDefault.context.interactive).toBe('boolean');
  expect(pipeDefault.context.interactive).toBe(false);
  expect(ttyDefault.context.stdoutIsTTY).toBe(true);
  expect(pipeDefault.context.stdoutIsTTY).toBe(false);
  expect(ttyDefault.bytes.includes('\u001b[?25l')).toBe(ttyDefault.context.interactive);
  expect(pipeDefault.bytes).not.toContain('\u001b[?25l');
  // The exact hook exposes Ink's resolved default. Public options only expose
  // that `interactive` was omitted; reproducing the TTY + CI decision would
  // couple Termwright to Ink's private policy rather than a public contract.
}

async function assertMultipleRoots(
  ink: DifferentialInkModule,
  bridge: ReturnType<typeof activateInkRendererObservation>,
  exact: ExactCapture[],
  commits: Extract<InkCommitEvent, { type: 'commit' }>[],
  instances: DifferentialInkInstance[],
): Promise<void> {
  const seen = new Set<InkDomElement>();
  const renderOne = (label: string): DifferentialInkInstance =>
    ink.render(createElement(ink.Text, null, label), {
      stdout: tty(20, 6),
      patchConsole: false,
      interactive: true,
      onRender() {
        const old = exact.at(-1)!;
        seen.add(old.root);
      },
    });
  const first = renderOne('root-one');
  const second = renderOne('root-two');
  instances.push(first, second);
  await Promise.all([first.waitUntilRenderFlush(), second.waitUntilRenderFlush()]);
  expect(seen.size).toBe(2);
  expect([...seen].map((root) => hostFacts(root).find((fact) => fact.text)?.text).sort()).toEqual([
    'root-one',
    'root-two',
  ]);
  for (const root of seen) expect(bridge.roots()).toContain(root);
  for (const root of seen) {
    expect(commits.findLast((candidate) => candidate.root === root)?.fiberRoot.containerInfo).toBe(
      root,
    );
  }
  await Promise.all([disposeInstance(first, instances), disposeInstance(second, instances)]);
}

async function disposeInstance(
  instance: DifferentialInkInstance,
  instances: DifferentialInkInstance[],
): Promise<void> {
  instance.unmount();
  await instance.waitUntilRenderFlush();
  const index = instances.indexOf(instance);
  if (index >= 0) instances.splice(index, 1);
}

function assertHostParity(boundary: {
  readonly old: ExactCapture;
  readonly runtimeRoot: InkDomElement;
  readonly runtimeFacts: readonly HostFact[];
}): void {
  expect(boundary.runtimeRoot).toBe(boundary.old.root);
  expect(boundary.runtimeFacts).toEqual(boundary.old.facts);
}

function pair(
  boundary: { readonly old: ExactCapture; readonly context: InkFrameContext },
  commits: readonly Extract<InkCommitEvent, { type: 'commit' }>[],
  commitFacts: ReadonlyMap<Extract<InkCommitEvent, { type: 'commit' }>, readonly HostFact[]>,
): {
  readonly old: ExactCapture;
  readonly runtimeRoot: InkDomElement;
  readonly runtimeFacts: readonly HostFact[];
  readonly context: InkFrameContext;
} {
  const commit = commits.findLast((candidate) => candidate.root === boundary.old.root);
  if (commit === undefined) throw new Error('React observer did not commit the exact-capture root');
  expect(commit.fiberRoot.containerInfo).toBe(boundary.old.root);
  const facts = commitFacts.get(commit);
  if (facts === undefined)
    throw new Error('React observer did not freeze its committed host facts');
  return {
    old: boundary.old,
    runtimeRoot: commit.root,
    runtimeFacts: facts,
    context: boundary.context,
  };
}

function committedSnapshot(
  exact: ExactCapture,
  commits: readonly Extract<InkCommitEvent, { type: 'commit' }>[],
  facts: ReadonlyMap<Extract<InkCommitEvent, { type: 'commit' }>, readonly HostFact[]>,
): { readonly root: InkDomElement; readonly facts: readonly HostFact[] } {
  const commit = commits.findLast((candidate) => candidate.root === exact.root);
  if (commit === undefined) throw new Error('React observer missed the Static root commit');
  const snapshot = facts.get(commit);
  if (snapshot === undefined) throw new Error('React observer missed the Static root snapshot');
  return { root: commit.root, facts: snapshot };
}

function assertMeasuredCausalOrdering(sequence: readonly string[]): void {
  const renderIndexes = sequence.flatMap((entry, index) =>
    entry.startsWith('render:') ? [index] : [],
  );
  expect(renderIndexes.length).toBeGreaterThan(0);
  let paired = 0;
  let withoutReactCommit = 0;
  for (const renderIndex of renderIndexes) {
    const prior = sequence.slice(0, renderIndex);
    const exactIndex = prior.findLastIndex((entry) => entry.startsWith('exact:'));
    const contextIndex = prior.findLastIndex((entry) => entry.startsWith('context:'));
    expect(exactIndex).toBeGreaterThanOrEqual(0);
    expect(contextIndex).toBeGreaterThan(exactIndex);
    const digest = sequence[renderIndex]?.slice('render:'.length);
    const matchingCommit = sequence.findIndex(
      (entry, index) => index > renderIndex && entry === `commit:${digest}`,
    );
    if (matchingCommit > renderIndex) paired += 1;
    else withoutReactCommit += 1;
  }
  expect(paired).toBeGreaterThan(0);
  // Resize produces exact/context/onRender without a React reconciliation.
  expect(withoutReactCommit).toBeGreaterThan(0);
}

function hostFacts(root: InkDomElement): readonly HostFact[] {
  const facts: HostFact[] = [];
  const visited = new Set<InkDomElement>();
  const walk = (node: InkDomElement, path: string, isStatic: boolean): void => {
    if (visited.has(node)) return;
    visited.add(node);
    const yoga = (node as InkDomElement & { readonly yogaNode?: YogaLike }).yogaNode;
    const children = node.childNodes;
    const text = textOf(children);
    facts.push({
      path,
      nodeName: node.nodeName,
      ...(text === undefined ? {} : { text }),
      ...(node.internal_accessibility?.role === undefined
        ? {}
        : { role: node.internal_accessibility.role }),
      ...(node.internal_accessibility?.state === undefined
        ? {}
        : { state: node.internal_accessibility.state }),
      ...(yoga === undefined
        ? {}
        : {
            geometry: [
              yoga.getComputedLeft(),
              yoga.getComputedTop(),
              yoga.getComputedWidth(),
              yoga.getComputedHeight(),
            ] as const,
          }),
      ...(node.style?.display === undefined ? {} : { display: node.style.display }),
      static: isStatic,
    });
    let elementIndex = 0;
    for (const child of children) {
      if (child.nodeName === '#text') continue;
      walk(child, `${path}/${elementIndex}`, isStatic || child.internal_static === true);
      elementIndex += 1;
    }
    if (node === root && node.staticNode !== undefined && !visited.has(node.staticNode)) {
      walk(node.staticNode, `${path}/static`, true);
    }
  };
  walk(root, 'root', false);
  return facts;
}

interface YogaLike {
  getComputedLeft(): number;
  getComputedTop(): number;
  getComputedWidth(): number;
  getComputedHeight(): number;
}

function textOf(children: readonly InkDomNode[]): string | undefined {
  const text = children
    .filter(
      (child): child is Extract<InkDomNode, { nodeName: '#text' }> => child.nodeName === '#text',
    )
    .map((child) => child.nodeValue)
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
  return text === '' ? undefined : text;
}

function findElementByOwnText(root: InkDomElement, expected: string): InkDomElement | undefined {
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop() as InkDomElement;
    if (textOf(node.childNodes) === expected) return node;
    for (const child of node.childNodes) {
      if (child.nodeName !== '#text') stack.push(child);
    }
  }
  return undefined;
}

function rootWidth(root: InkDomElement): number {
  return (
    (root as InkDomElement & { readonly yogaNode?: YogaLike }).yogaNode?.getComputedWidth() ?? -1
  );
}

function rootHeight(root: InkDomElement): number {
  return (
    (root as InkDomElement & { readonly yogaNode?: YogaLike }).yogaNode?.getComputedHeight() ?? -1
  );
}

function digestFacts(facts: readonly HostFact[]): string {
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex').slice(0, 12);
}

function tty(
  columns: number,
  rows: number,
): NodeJS.WriteStream & { columns: number; rows: number } {
  const stream = new PassThrough() as unknown as NodeJS.WriteStream & {
    columns: number;
    rows: number;
  };
  Object.defineProperties(stream, {
    columns: { value: columns, writable: true, configurable: true },
    rows: { value: rows, writable: true, configurable: true },
    isTTY: { value: true, configurable: true },
  });
  return stream;
}

function recordingTty(
  columns: number,
  rows: number,
): { readonly stream: NodeJS.WriteStream; bytes(): string } {
  const stream = tty(columns, rows);
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer | string) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  return {
    stream,
    bytes: () => Buffer.concat(chunks).toString('utf8'),
  };
}

function ttyInput(): NodeJS.ReadStream & { write(chunk: string): boolean } {
  const stream = new PassThrough() as unknown as NodeJS.ReadStream & {
    write(chunk: string): boolean;
  };
  Object.defineProperties(stream, {
    isTTY: { value: true, configurable: true },
    isRaw: { value: false, writable: true, configurable: true },
    setRawMode: {
      value(mode: boolean) {
        Object.defineProperty(stream, 'isRaw', {
          value: mode,
          writable: true,
          configurable: true,
        });
        return stream;
      },
    },
    ref: {
      value() {
        return stream;
      },
    },
    unref: {
      value() {
        return stream;
      },
    },
  });
  return stream;
}

async function materializeInstrumentedInk(): Promise<{
  readonly directory: string;
  readonly id: string;
  readonly indexUrl: string;
  readonly reconcilerUrl: string;
}> {
  // Keep the copy beside Ink's own build so Node resolves Ink's transitive
  // pnpm dependencies through the same package-local node_modules graph.
  const directory = await mkdtemp(join(dirname(upstreamBuild), '.termwright-differential-'));
  const build = join(directory, 'build');
  await cp(upstreamBuild, build, { recursive: true });
  const rendererPath = join(build, 'renderer.js');
  const corePath = join(build, 'ink.js');
  // Certification matches the immutable upstream artifact path and bytes. The
  // transformed output is then materialized in this isolated package copy.
  const renderer = instrumentInkRenderer(
    join(upstreamBuild, 'renderer.js'),
    await readFile(rendererPath, 'utf8'),
  );
  const core = instrumentInkCore(join(upstreamBuild, 'ink.js'), await readFile(corePath, 'utf8'));
  if (renderer === undefined || core === undefined) {
    throw new Error('pinned Ink artifacts could not be instrumented for differential conformance');
  }
  await writeFile(rendererPath, renderer);
  await writeFile(corePath, core);
  const id = createHash('sha256').update(directory).digest('hex').slice(0, 12);
  return {
    directory,
    id,
    indexUrl: pathToFileURL(join(build, 'index.js')).href,
    reconcilerUrl: pathToFileURL(join(build, 'reconciler.js')).href,
  };
}
