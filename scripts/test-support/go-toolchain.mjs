/**
 * Runs one Go-backed test capability probe without letting CI turn failures
 * into skips. Local environments may still omit Go explicitly or implicitly.
 *
 * @template T
 * @param {() => Promise<T>} probe
 * @param {T} unavailable
 * @param {string} label
 * @param {Readonly<Record<string, string | undefined>>} [env]
 * @returns {Promise<T>}
 */
export async function goTestCapability(probe, unavailable, label, env = process.env) {
  if (env['TERMWRIGHT_SKIP_GO'] === '1') {
    if (env['TERMWRIGHT_REQUIRE_GO'] === '1') {
      throw new Error('TERMWRIGHT_SKIP_GO conflicts with required Go certification');
    }
    return unavailable;
  }
  try {
    return await probe();
  } catch (error) {
    if (env['TERMWRIGHT_REQUIRE_GO'] === '1') {
      throw new Error(`${label} is unavailable`, { cause: error });
    }
    return unavailable;
  }
}
