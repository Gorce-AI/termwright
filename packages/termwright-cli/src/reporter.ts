/**
 * `termwright/reporter` — the trace reporter, re-exported.
 *
 * A `vitest.config.ts` runs before the test runner exists and must not import
 * a module that registers matchers, which is why the reporter is a separate
 * entry point in `@termwright/test` and a separate one here.
 *
 * This subpath exists so that a project whose only devDependency is
 * `termwright` can still write its Vitest config. Reaching for
 * `@termwright/test/reporter` directly works only where the package manager
 * hoists transitive dependencies; under pnpm's default layout it does not
 * resolve.
 *
 * @example
 * ```ts
 * // vitest.config.ts
 * import { defineConfig } from 'vitest/config';
 * import TermwrightReporter from 'termwright/reporter';
 *
 * export default defineConfig({
 *   test: { reporters: ['default', new TermwrightReporter()] },
 * });
 * ```
 *
 * @packageDocumentation
 */

export { default } from '@termwright/test/reporter';
export * from '@termwright/test/reporter';
