/**
 * Runs every cleanup and preserves the primary operation failure alongside all
 * cleanup failures. Cleanup callbacks are used instead of promises so every
 * attempt starts even when an earlier cleanup rejects synchronously.
 */
export async function finishWithCleanups({ hasPrimary, primaryError, cleanups, message }) {
  if (typeof hasPrimary !== 'boolean') throw new TypeError('hasPrimary must be a boolean');
  if (!Array.isArray(cleanups) || cleanups.some((cleanup) => typeof cleanup !== 'function')) {
    throw new TypeError('cleanups must be an array of functions');
  }
  const results = await Promise.allSettled(cleanups.map((cleanup) => Promise.resolve().then(cleanup)));
  const cleanupErrors = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);
  if (cleanupErrors.length === 0) {
    if (hasPrimary) throw primaryError;
    return;
  }
  if (!hasPrimary && cleanupErrors.length === 1) throw cleanupErrors[0];
  const errors = hasPrimary ? [primaryError, ...cleanupErrors] : cleanupErrors;
  throw new AggregateError(errors, message, hasPrimary ? { cause: primaryError } : undefined);
}
