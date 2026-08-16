/**
 * Errors thrown across the `@termwright/trace` package boundary.
 *
 * The monorepo contract requires cross-package errors to be `TermwrightError`
 * subclasses. `@termwright/driver` currently publishes `TermwrightError` as a
 * declaration only (`declare class`), so trace cannot extend it at runtime
 * without taking a runtime dependency on the driver — which the dependency
 * rules forbid ("trace depends on driver *types* only"). {@link TraceError} is
 * therefore structurally identical: same `code` domain, same `diagnostics`
 * shape. See `NOTES.md`.
 */

import type { TermwrightErrorCode, ErrorDiagnostics } from '@termwright/driver';

/**
 * Error raised by trace writers, readers and the report generator.
 *
 * @example
 * ```ts
 * try {
 *   await openTrace('/tmp/broken.twtrace');
 * } catch (err) {
 *   if (err instanceof TraceError && err.code === 'not-found') {
 *     console.error(err.diagnostics.suggestion);
 *   }
 * }
 * ```
 */
export class TraceError extends Error {
  /** Stable machine-readable code, shared with the driver's error domain. */
  readonly code: TermwrightErrorCode;
  /** Bounded diagnostic context; never contains unbounded payloads. */
  readonly diagnostics: ErrorDiagnostics;

  constructor(
    code: TermwrightErrorCode,
    message: string,
    diagnostics: { [K in keyof ErrorDiagnostics]?: ErrorDiagnostics[K] | undefined } = {},
  ) {
    super(message);
    this.name = 'TraceError';
    this.code = code;
    this.diagnostics = {
      semanticTree: diagnostics.semanticTree ?? false,
      ...(diagnostics.screenExcerpt === undefined
        ? {}
        : { screenExcerpt: diagnostics.screenExcerpt }),
      ...(diagnostics.candidates === undefined ? {} : { candidates: diagnostics.candidates }),
      ...(diagnostics.suggestion === undefined ? {} : { suggestion: diagnostics.suggestion }),
    };
  }
}
