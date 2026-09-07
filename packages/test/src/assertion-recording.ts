/** Observe the certified engine's matcher boundary, preserving its soft semantics. */
import { chai } from 'vitest';
import { wrapAssertion } from '@vitest/expect';
import { assertionRecording, type AssertionRecording } from './assertion-context.js';
import { optionalAttemptRuntime } from './attempt-context.js';
import { currentStepId, writeAssert, type TermwrightScope } from './trace-context.js';

type Assertion = ThisParameterType<Parameters<typeof wrapAssertion>[2]>;
type Matcher = (this: Assertion, ...args: unknown[]) => unknown;
const installed = Symbol.for('termwright.test.assertion-recording.installed.v1');
const wrapped = new WeakSet<Matcher>();

export function registerAssertionRecording(): void {
  const prototype = chai.Assertion.prototype as typeof chai.Assertion.prototype & {
    withContext: Matcher;
  };
  if (Reflect.get(prototype, installed)) return;
  Object.defineProperty(prototype, installed, { value: true });

  const instrument = () => {
    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (!/^to[A-Z]/u.test(name)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      if (typeof descriptor?.value !== 'function' || wrapped.has(descriptor.value)) continue;
      const method = tracedMatcher(name, descriptor.value as Matcher);
      wrapped.add(method);
      Object.defineProperty(prototype, name, { ...descriptor, value: method });
    }
  };
  // Every expect instance (including test.context.expect) delegates registration
  // here. New user matchers and engine-local expects must retain instrumentation.
  const chaiExpect = chai.expect as typeof chai.expect & {
    extend: (expect: unknown, matchers: Record<string, unknown>) => unknown;
  };
  const extend = chaiExpect.extend;
  chaiExpect.extend = function (...args: Parameters<typeof extend>) {
    const result = extend.apply(this, args);
    instrument();
    return result;
  };
  instrument();

  // Promise polarity can fail before a matcher runs. Observe the outer chain,
  // keeping the inner matcher in the same recording rather than emitting twice.
  for (const name of ['resolves', 'rejects']) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    const get = descriptor?.get;
    if (get === undefined) continue;
    Object.defineProperty(prototype, name, {
      ...descriptor,
      get() {
        const assertion = get.call(this) as object;
        return new Proxy(assertion, {
          get(target, key, receiver) {
            const value: unknown = Reflect.get(target, key, receiver);
            return typeof key === 'string' && /^to[A-Z]/u.test(key) && typeof value === 'function'
              ? tracedMatcher(key, value as Matcher)
              : value instanceof chai.Assertion
                ? receiver
                : value;
          },
        });
      },
    });
  }

  // The engine reads onSettled before its first poll. Install the observer when
  // it marks the assertion as a poll, not while an individual probe is running.
  const withContext = prototype.withContext as Matcher;
  prototype.withContext = function (this: Assertion, ...args: unknown[]) {
    const result = withContext.apply(this, args);
    if (chai.util.flag(this, 'poll') && !chai.util.flag(this, 'termwright.poll')) {
      chai.util.flag(this, 'termwright.poll', true);
      const previous = chai.util.flag(this, '_poll.onSettled') as
        ((result: { status: string }) => unknown) | undefined;
      chai.util.flag(this, '_poll.onSettled', async (result: { status: string }) => {
        const scope = optionalAttemptRuntime()?.scope as TermwrightScope | undefined;
        const record = chai.util.flag(this, 'termwright.poll.record') as
          AssertionRecording['record'] | undefined;
        if (scope !== undefined) {
          writeAssert(
            scope,
            {
              ...record,
              api: record?.api ?? String(chai.util.flag(this, '_name')),
              ok: result.status === 'pass',
            },
            currentStepId(scope),
          );
        }
        await previous?.(result);
      });
    }
    return result;
  } as typeof prototype.withContext;
}

function tracedMatcher(name: string, original: Matcher): Matcher {
  const method = wrapAssertion(chai.util, name, function (...args: unknown[]) {
    const scope = optionalAttemptRuntime()?.scope as TermwrightScope | undefined;
    if (scope === undefined) return original.apply(this, args) as void;
    const recording: AssertionRecording = { api: name };
    const stepId = currentStepId(scope);
    const prefix = `${chai.util.flag(this, 'promise') ? `${String(chai.util.flag(this, 'promise'))}.` : ''}${chai.util.flag(this, 'negate') ? 'not.' : ''}`;
    const finish = (ok: boolean, error?: unknown) => {
      const record = {
        ...recording.record,
        api: `${prefix}${recording.record?.api ?? name}`,
        ok,
        ...(error === undefined
          ? {}
          : { error: error instanceof Error ? error.message : String(error) }),
      };
      if (chai.util.flag(this, 'poll')) chai.util.flag(this, 'termwright.poll.record', record);
      else writeAssert(scope, record, stepId);
    };
    // The outer certified wrapAssertion owns soft error handling. Disable only
    // the inner copy, so a swallowed soft failure is still recorded as failed.
    const soft = chai.util.flag(this, 'soft');
    try {
      chai.util.flag(this, 'soft', false);
      const result = assertionRecording.run(recording, () => original.apply(this, args));
      if (
        result !== null &&
        typeof result === 'object' &&
        'then' in result &&
        typeof result.then === 'function'
      ) {
        return Promise.resolve(result).then(
          () => {
            finish(true);
          },
          (error: unknown) => {
            finish(false, error);
            throw error;
          },
        );
      }
      finish(true);
      return result as void;
    } catch (error) {
      finish(false, error);
      throw error;
    } finally {
      chai.util.flag(this, 'soft', soft);
    }
  });
  // Domain snapshot matchers can take over expect.poll; keep that engine marker.
  const entry: Matcher = function (...args) {
    if (optionalAttemptRuntime()?.scope === undefined) return original.apply(this, args);
    if (assertionRecording.getStore() !== undefined) {
      const soft = chai.util.flag(this, 'soft');
      try {
        chai.util.flag(this, 'soft', false);
        return original.apply(this, args);
      } finally {
        chai.util.flag(this, 'soft', soft);
      }
    }
    return method.apply(this, args);
  };
  Object.assign(entry, original);
  const takeover = Object.getOwnPropertyDescriptor(original, '__vitest_poll_takeover__');
  if (takeover !== undefined) Object.defineProperty(entry, '__vitest_poll_takeover__', takeover);
  return entry;
}
