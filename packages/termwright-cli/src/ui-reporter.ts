/**
 * `termwright/ui-reporter` — the runner's Vitest bridge, re-exported.
 *
 * Configure it to fill the runner's timeline while a suite runs. It publishes
 * to `process.env.TERMWRIGHT_UI_URL`, which `termwright ui` sets, and does
 * nothing at all when that variable is unset — so it is safe to leave in a
 * repository whose runs are mostly headless.
 *
 * Separate from `termwright/reporter` because they are two independent
 * reporters that compose: one writes `.twtrace` archives, the other streams a
 * live run to the browser. Run both.
 *
 * @example
 * ```ts
 * // vitest.config.ts
 * import { defineConfig } from 'vitest/config';
 * import TermwrightReporter from 'termwright/reporter';
 * import TermwrightUiReporter from 'termwright/ui-reporter';
 *
 * export default defineConfig({
 *   test: { reporters: ['default', new TermwrightReporter(), new TermwrightUiReporter()] },
 * });
 * ```
 *
 * @packageDocumentation
 */

export { default } from '@termwright/ui/reporter';
export * from '@termwright/ui/reporter';
