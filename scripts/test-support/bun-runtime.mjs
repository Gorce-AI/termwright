/**
 * Resolve a Bun-backed test capability without allowing certifying jobs to
 * turn a missing runtime into reduced coverage. Developer runs may still omit
 * or deliberately skip Bun.
 *
 * @param {() => boolean} probe
 * @param {Readonly<Record<string, string | undefined>>} [env]
 * @returns {boolean}
 */
export function bunTestCapability(probe, env = process.env) {
  if (env['TERMWRIGHT_SKIP_BUN'] === '1') {
    if (env['TERMWRIGHT_REQUIRE_BUN'] === '1') {
      throw new Error('TERMWRIGHT_SKIP_BUN conflicts with required Bun certification');
    }
    return false;
  }

  let available = false;
  try {
    available = probe();
  } catch (error) {
    if (env['TERMWRIGHT_REQUIRE_BUN'] === '1') {
      throw new Error('Bun runtime is unavailable', { cause: error });
    }
    return false;
  }

  if (!available && env['TERMWRIGHT_REQUIRE_BUN'] === '1') {
    throw new Error('Bun runtime is unavailable');
  }
  return available;
}
