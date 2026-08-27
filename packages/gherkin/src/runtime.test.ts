import { describe, expect, expectTypeOf, test, vi } from 'vitest';
import {
  After,
  Before,
  Given,
  defineParameterType,
  defineSteps,
  type GherkinContext,
} from './definitions.js';
import {
  createGherkinContext,
  createGherkinRuntime,
  runGherkinScenario,
  runGherkinStep,
} from './runtime.js';

function context(): { value: GherkinContext; titles: string[] } {
  const titles: string[] = [];
  const value = {
    world: {},
    scenario: { feature: 'Feature', name: 'Scenario', uri: 'feature.feature', line: 2, tags: [] },
    step: async <T>(title: string, body: () => T | Promise<T>): Promise<T> => {
      titles.push(title);
      return body();
    },
  } as unknown as GherkinContext;
  return { value, titles };
}

describe('feature-local runtime', () => {
  test('types project fixtures alongside the native Gherkin context', () => {
    interface ProjectFixtures {
      readonly account: { readonly name: string };
    }
    const definitions = defineSteps<ProjectFixtures>(
      Before<ProjectFixtures>(({ account, terminal }) => {
        expectTypeOf(account.name).toEqualTypeOf<string>();
        expectTypeOf(terminal).toBeObject();
      }),
      Given<ProjectFixtures>('an account', ({ account, world }) => {
        expectTypeOf(account.name).toEqualTypeOf<string>();
        expectTypeOf(world).toEqualTypeOf<Record<string, unknown>>();
        // @ts-expect-error Only explicitly declared project fixtures pass through.
        void account.missing;
      }),
      After<ProjectFixtures>(({ account }) => {
        expectTypeOf(account.name).toEqualTypeOf<string>();
      }),
    );

    expect(definitions).toHaveLength(3);
  });

  test('uses only matches from the nearest tier', async () => {
    const nearest = vi.fn();
    const global = vi.fn();
    const runtime = createGherkinRuntime([
      { path: '/feature.steps.ts', tier: 0, definitions: defineSteps(Given('a value', nearest)) },
      { path: '/global.ts', tier: 4, definitions: defineSteps(Given('a value', global)) },
    ]);

    await runtime.run({ text: 'a value', title: 'Given a value' }, context().value);

    expect(nearest).toHaveBeenCalledOnce();
    expect(global).not.toHaveBeenCalled();
  });

  test('reports ambiguity when two definitions match in the nearest tier', async () => {
    const runtime = createGherkinRuntime([
      { path: '/a.ts', tier: 1, definitions: defineSteps(Given('a value', vi.fn())) },
      { path: '/b.ts', tier: 1, definitions: defineSteps(Given(/^a value$/, vi.fn())) },
      { path: '/far.ts', tier: 2, definitions: defineSteps(Given('a value', vi.fn())) },
    ]);

    await expect(
      runtime.run({ text: 'a value', title: 'Given a value' }, context().value),
    ).rejects.toThrow(/Ambiguous Gherkin step.*\/a\.ts.*\/b\.ts/s);
  });

  test('validates undefined and ambiguous steps without executing bodies', () => {
    const body = vi.fn();
    const runtime = createGherkinRuntime([
      {
        path: '/steps.ts',
        tier: 0,
        definitions: defineSteps(
          Given('known', body),
          Given(/^duplicate$/, body),
          Given('duplicate', body),
        ),
      },
    ]);

    expect(() => runtime.validate({ text: 'known', title: 'known' })).not.toThrow();
    expect(() => runtime.validate({ text: 'missing', title: 'missing' })).toThrow(
      /Undefined Gherkin step/u,
    );
    expect(() => runtime.validate({ text: 'duplicate', title: 'duplicate' })).toThrow(
      /Ambiguous Gherkin step/u,
    );
    expect(body).not.toHaveBeenCalled();
  });

  test('does not run parameter transformers before resolving ambiguity', async () => {
    const transformer = vi.fn((_value: string): string => {
      throw new Error('transformer must not run for an ambiguous step');
    });
    const runtime = createGherkinRuntime([
      {
        path: '/ambiguous.ts',
        tier: 0,
        definitions: defineSteps(
          defineParameterType({ name: 'token', regexp: /\w+/, transformer }),
          Given('a {token}', vi.fn()),
          Given('a {token}', vi.fn()),
        ),
      },
    ]);

    await expect(
      runtime.run({ text: 'a value', title: 'Given a value' }, context().value),
    ).rejects.toThrow(/Ambiguous Gherkin step/);
    expect(transformer).not.toHaveBeenCalled();
  });

  test('wraps every execution in the native Termwright step fixture', async () => {
    const body = vi.fn();
    const runtime = createGherkinRuntime([
      { path: '/steps.ts', tier: 0, definitions: defineSteps(Given('a value', body)) },
    ]);
    const testContext = context();

    await runGherkinStep(runtime, testContext.value, {
      text: 'a value',
      title: 'Background · Given a value',
    });

    expect(testContext.titles).toEqual(['Background · Given a value']);
    expect(body).toHaveBeenCalledOnce();
  });

  test('lets a nearer custom parameter type override the same global name', async () => {
    const body = vi.fn();
    const runtime = createGherkinRuntime([
      {
        path: '/local.ts',
        tier: 0,
        definitions: defineSteps(
          defineParameterType({
            name: 'token',
            regexp: /\w+/,
            transformer: (value) => `local:${value}`,
          }),
        ),
      },
      {
        path: '/global.ts',
        tier: 4,
        definitions: defineSteps(
          defineParameterType({
            name: 'token',
            regexp: /\w+/,
            transformer: (value) => `global:${value}`,
          }),
          Given('a {token}', body),
        ),
      },
    ]);

    await runtime.run({ text: 'a value', title: 'Given a value' }, context().value);

    expect(body).toHaveBeenCalledWith(expect.anything(), 'local:value');
  });

  test('runs scoped hooks and LIFO resource cleanup around each scenario', async () => {
    const calls: string[] = [];
    const runtime = createGherkinRuntime([
      {
        path: '/steps.ts',
        tier: 0,
        definitions: defineSteps(
          Before(({ defer }) => {
            calls.push('before');
            defer(() => calls.push('cleanup:first'));
            defer(() => calls.push('cleanup:last'));
          }),
          Given('a value', () => calls.push('step')),
          After(() => calls.push('after')),
        ),
      },
    ]);
    const managed = createGherkinContext(context().value);

    await runGherkinScenario(runtime, managed, async () => {
      await runtime.run({ text: 'a value', title: 'Given a value' }, managed);
    });

    expect(calls).toEqual(['before', 'step', 'after', 'cleanup:last', 'cleanup:first']);
  });

  test('runs After hooks and cleanup when a scenario fails', async () => {
    const after = vi.fn();
    const close = vi.fn();
    const runtime = createGherkinRuntime([
      {
        path: '/steps.ts',
        tier: 0,
        definitions: defineSteps(
          Before(({ use }) => use({ close })),
          After(after),
        ),
      },
    ]);
    const managed = createGherkinContext(context().value);

    await expect(
      runGherkinScenario(runtime, managed, async () => {
        throw new Error('scenario failed');
      }),
    ).rejects.toThrow('scenario failed');

    expect(after).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  test('selects scenario hooks with Cucumber tag expressions', async () => {
    const smoke = vi.fn();
    const slow = vi.fn();
    const runtime = createGherkinRuntime([
      {
        path: '/steps.ts',
        tier: 0,
        definitions: defineSteps(
          Before({ tags: '@smoke and not @slow' }, smoke),
          Before({ tags: '@slow' }, slow),
        ),
      },
    ]);
    const base = context().value;
    const managed = createGherkinContext({
      ...base,
      scenario: { ...base.scenario, tags: ['@smoke'] },
    });

    await runGherkinScenario(runtime, managed, async () => undefined);

    expect(smoke).toHaveBeenCalledOnce();
    expect(slow).not.toHaveBeenCalled();
  });
});
