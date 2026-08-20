import { describe, expect, test, vi } from 'vitest';
import { Given, defineParameterType, defineSteps, type GherkinContext } from './definitions.js';
import { createGherkinRuntime, runGherkinStep } from './runtime.js';

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

    await expect(runtime.run(
      { text: 'a value', title: 'Given a value' },
      context().value,
    )).rejects.toThrow(/Ambiguous Gherkin step.*\/a\.ts.*\/b\.ts/s);
  });

  test('does not run parameter transformers before resolving ambiguity', async () => {
    const transformer = vi.fn((_value: string): string => {
      throw new Error('transformer must not run for an ambiguous step');
    });
    const runtime = createGherkinRuntime([{
      path: '/ambiguous.ts',
      tier: 0,
      definitions: defineSteps(
        defineParameterType({ name: 'token', regexp: /\w+/, transformer }),
        Given('a {token}', vi.fn()),
        Given('a {token}', vi.fn()),
      ),
    }]);

    await expect(runtime.run(
      { text: 'a value', title: 'Given a value' },
      context().value,
    )).rejects.toThrow(/Ambiguous Gherkin step/);
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
        definitions: defineSteps(defineParameterType({
          name: 'token',
          regexp: /\w+/,
          transformer: (value) => `local:${value}`,
        })),
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
});
